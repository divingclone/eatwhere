import { describe, expect, test } from 'bun:test';
import { dataInfo, defaultFriends, districts, metroLines, metroStations } from './data';
import {
  distanceKm,
  drivingOriginKey,
  planRoute,
  rankDistricts,
  routingAssumptions,
} from './routing';
import type { DrivingRouteData, DrivingRouteOverrides, Friend } from './types';

describe('bundled Shenzhen network', () => {
  test('every line references valid stations and shared interchanges connect the network', () => {
    expect(metroStations.length).toBeGreaterThan(300);
    expect(metroLines.length).toBeGreaterThanOrEqual(14);
    expect(new Set(metroStations.map((station) => station.id)).size).toBe(metroStations.length);
    const byId = new Map(metroStations.map((station) => [station.id, station]));
    for (const line of metroLines) {
      expect(line.stationIds.length).toBeGreaterThan(1);
      for (const stationId of line.stationIds) {
        expect(byId.get(stationId)?.lineIds).toContain(line.id);
      }
    }
    expect(metroStations.find((station) => station.name === '车公庙')?.lineIds).toEqual(
      expect.arrayContaining(['1', '7', '9', '11']),
    );
    expect(metroLines.find((line) => line.id === '2')?.name).toContain('8');
    expect(dataInfo.source).toContain('map.amap.com');
  });

  test('coordinates and distance use WGS84 degrees / kilometers', () => {
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.195, 2);
    expect(distanceKm(defaultFriends[0]!.location, defaultFriends[0]!.location)).toBe(0);
    const luohu = metroStations.find((station) => station.name === '罗湖')!;
    // The source GCJ02 longitude is 114.118666; storing it unchanged would shift the map.
    expect(luohu.location.lng).toBeLessThan(114.116);
    for (const station of metroStations) {
      expect(station.location.lng).toBeGreaterThan(113);
      expect(station.location.lng).toBeLessThan(115);
      expect(station.location.lat).toBeGreaterThan(22);
      expect(station.location.lat).toBeLessThan(23.5);
    }
  });
});

describe('walking + metro route planning', () => {
  test('all default meeting routes are reachable with continuous, valid metro legs', () => {
    const lines = new Map(metroLines.map((line) => [line.id, line]));
    const byName = new Map(metroStations.map((station) => [station.name, station]));
    for (const friend of defaultFriends) {
      for (const district of districts) {
        const route = planRoute(friend, district);
        expect(route.reachable).toBe(true);
        expect(route.minutes).toBeGreaterThan(0);
        expect(route.minutes).toBe(route.steps.reduce((total, step) => total + step.minutes, 0));
        expect(route.coordinates[0]).toEqual(friend.location);
        expect(route.coordinates.at(-1)).toEqual(district.location);
        for (const step of route.steps.filter((candidate) => candidate.type === 'metro')) {
          const line = lines.get(step.lineId!)!;
          const first = line.stationIds.indexOf(byName.get(step.from!)!.id);
          const last = line.stationIds.indexOf(byName.get(step.to!)!.id);
          expect(first).toBeGreaterThanOrEqual(0);
          expect(last).toBeGreaterThanOrEqual(0);
          expect(Math.abs(last - first)).toBe(step.stops!);
          expect(step.coordinates.length).toBe(step.stops! + 1);
        }
        for (let index = 1; index < route.steps.length; index += 1) {
          expect(route.steps[index - 1]!.coordinates.at(-1)).toEqual(
            route.steps[index]!.coordinates[0],
          );
        }
      }
    }
  });

  test('considers a farther access station to catch a faster line', () => {
    const route = planRoute(
      defaultFriends[0]!,
      districts.find((district) => district.id === 'gangxia')!,
    );
    const nearest = [...metroStations].sort(
      (a, b) =>
        distanceKm(defaultFriends[0]!.location, a.location) -
        distanceKm(defaultFriends[0]!.location, b.location),
    )[0]!;
    expect(nearest.name).toBe('宝安中心');
    expect(route.steps[0]!.to).toBe('宝安');
    expect(route.steps.some((step) => step.lineId === '11')).toBe(true);
    expect(route.transfers).toBe(0);
  });

  test('charges transfer time and retains interchange details', () => {
    const route = planRoute(
      defaultFriends[1]!,
      districts.find((district) => district.id === 'coastal-city')!,
    );
    const transfers = route.steps.filter((step) => step.type === 'transfer');
    expect(transfers.length).toBeGreaterThan(0);
    expect(route.transfers).toBe(transfers.length);
    for (const transfer of transfers) {
      expect(transfer.minutes).toBeGreaterThanOrEqual(routingAssumptions.transferMinutes);
      const station = metroStations.find((candidate) => candidate.name === transfer.from)!;
      expect(station.lineIds).toContain(transfer.lineId!);
      expect(transfer.from).toBe(transfer.to);
    }
    expect(route.steps.find((step) => step.type === 'metro')!.label).toContain('候车');
  });

  test('chooses direct walking for a nearby destination', () => {
    const district = districts.find((candidate) => candidate.id === 'baoan')!;
    const route = planRoute(defaultFriends[0]!, district);
    expect(route.steps).toHaveLength(1);
    expect(route.steps[0]!.type).toBe('walk');
    expect(route.minutes).toBeLessThan(10);
    expect(route.transfers).toBe(0);
  });

  test('does not invent a long access leg for an origin outside the metro catchment', () => {
    const remote: Friend = {
      ...defaultFriends[0]!,
      id: 'remote',
      location: { lng: 113.5, lat: 22.4 },
    };
    const route = planRoute(remote, districts[0]!);
    expect(route.reachable).toBe(false);
    expect(route.minutes).toBe(Infinity);
    expect(route.steps).toHaveLength(0);
    expect(
      rankDistricts([remote, defaultFriends[1]!], 'balanced').every(
        (item) => item.score === Infinity,
      ),
    ).toBe(true);
    expect(
      planRoute({ ...remote, location: { lng: NaN, lat: 22.5 } }, districts[0]!).reachable,
    ).toBe(false);
  });
});

describe('participation in meeting recommendations', () => {
  test('disabled high-weight or unreachable friends do not affect scores, times, or routes', () => {
    const attending = defaultFriends.slice(0, 2);
    const absent = [
      { ...defaultFriends[2]!, enabled: false, weight: 2 },
      {
        ...defaultFriends[0]!,
        id: 'absent-unreachable',
        enabled: false,
        location: { lng: 113.5, lat: 22.4 },
        weight: 2,
      },
    ];
    for (const strategy of ['balanced', 'total', 'fair'] as const) {
      const baseline = rankDistricts(attending, strategy);
      expect(baseline).toHaveLength(districts.length);
      expect(
        rankDistricts([absent[0]!, attending[0]!, absent[1]!, attending[1]!], strategy),
      ).toEqual(baseline);
      expect(
        rankDistricts([...attending, { ...absent[1]!, enabled: true }], strategy).every(
          (recommendation) => recommendation.score === Infinity,
        ),
      ).toBe(true);
    }
  });

  test('reselecting friends restores rankings, and older friends without enabled still participate', () => {
    const original = defaultFriends.map((friend, index) => ({
      ...friend,
      weight: index === 2 ? 2 : 1,
    }));
    const absent = original.map((friend, index) => ({ ...friend, enabled: index !== 2 }));
    const reselected = absent.map((friend) => ({ ...friend, enabled: true }));
    const legacy = original.map(({ enabled: _enabled, ...friend }) => friend);
    for (const strategy of ['balanced', 'total', 'fair'] as const) {
      const baseline = rankDistricts(original, strategy);
      expect(rankDistricts(absent, strategy)).toEqual(
        rankDistricts(original.slice(0, 2), strategy),
      );
      expect(rankDistricts(reselected, strategy)).toEqual(baseline);
      expect(rankDistricts(legacy, strategy)).toEqual(baseline);
    }
    expect(planRoute(absent[2]!, districts[0]!)).toBe(planRoute(original[2]!, districts[0]!));
  });

  test('zero or one participant produces no group recommendation', () => {
    const allAbsent = defaultFriends.map((friend) => ({ ...friend, enabled: false }));
    const oneAttending = allAbsent.map((friend, index) => ({ ...friend, enabled: index === 0 }));
    for (const strategy of ['balanced', 'total', 'fair'] as const) {
      for (const friends of [[], [defaultFriends[0]!], allAbsent, oneAttending]) {
        expect(rankDistricts(friends, strategy)).toEqual([]);
      }
    }
  });

  test('absent drivers never contribute API routes and reselecting them uses the same road data', () => {
    const attending = defaultFriends.slice(0, 2);
    const driver: Friend = {
      ...defaultFriends[2]!,
      enabled: false,
      travelMode: 'driving',
      weight: 2,
    };
    const roadOverrides: DrivingRouteOverrides = {
      [drivingOriginKey(driver.location)]: districts.map((district) => ({
        districtId: district.id,
        minutes: 90,
        distanceKm: 40,
        coordinates: [driver.location, district.location],
      })),
    };
    for (const strategy of ['balanced', 'total', 'fair'] as const) {
      expect(rankDistricts([...attending, driver], strategy, roadOverrides)).toEqual(
        rankDistricts(attending, strategy),
      );
      const reselected = rankDistricts(
        [...attending, { ...driver, enabled: true }],
        strategy,
        roadOverrides,
      );
      expect(reselected.every((item) => item.routes[2]!.source === 'amap')).toBe(true);
      expect(reselected.every((item) => item.routes[2]!.minutes === 95)).toBe(true);
      expect(reselected.every((item) => item.routes[2]!.friendId === driver.id)).toBe(true);
    }
    expect(planRoute(driver, districts[0]!, roadOverrides).source).toBe('amap');
  });
});

describe('meeting recommendation weights', () => {
  test('lowering the eastern friend weight moves the choice west and reduces others travel', () => {
    const baseline = rankDistricts(defaultFriends, 'balanced')[0]!;
    const willingFriends = defaultFriends.map((friend, index) => ({
      ...friend,
      weight: index === 2 ? 0.2 : 1,
    }));
    const adjusted = rankDistricts(willingFriends, 'balanced')[0]!;
    expect(adjusted.district.id).not.toBe(baseline.district.id);
    expect(adjusted.district.location.lng).toBeLessThan(baseline.district.location.lng);
    expect(adjusted.routes[0]!.minutes + adjusted.routes[1]!.minutes).toBeLessThan(
      baseline.routes[0]!.minutes + baseline.routes[1]!.minutes,
    );
    expect(adjusted.routes[2]!.minutes).toBeGreaterThan(baseline.routes[2]!.minutes);
  });

  test('all strategies sort scores and changing weights reuses route calculations', () => {
    for (const strategy of ['balanced', 'total', 'fair'] as const) {
      const result = rankDistricts(defaultFriends, strategy);
      for (let index = 1; index < result.length; index += 1)
        expect(result[index]!.score).toBeGreaterThanOrEqual(result[index - 1]!.score);
      const scaled = rankDistricts(
        defaultFriends.map((friend) => ({ ...friend, weight: friend.weight * 2 })),
        strategy,
      );
      expect(scaled.map((item) => item.district.id)).toEqual(
        result.map((item) => item.district.id),
      );
      expect(scaled[0]!.score).toBeCloseTo(result[0]!.score, 8);
    }
    expect(planRoute({ ...defaultFriends[0]!, weight: 0.2 }, districts[0]!)).toBe(
      planRoute(defaultFriends[0]!, districts[0]!),
    );
    expect(rankDistricts([], 'balanced')).toEqual([]);
    expect(
      rankDistricts(
        defaultFriends.map((friend) => ({ ...friend, weight: 0 })),
        'fair',
      )[0]!.score,
    ).toBeFinite();
  });
});

describe('per-person driving and mixed travel modes', () => {
  const driver: Friend = { ...defaultFriends[0]!, travelMode: 'driving' };
  const district = districts[0]!;
  const roadData: DrivingRouteData = {
    districtId: district.id,
    minutes: 19.6,
    distanceKm: 12.3,
    coordinates: [driver.location, { lng: 113.99, lat: 22.55 }, district.location],
  };
  const overrides: DrivingRouteOverrides = { [drivingOriginKey(driver.location)]: [roadData] };

  test('old saved friends without a mode reproduce transit routes and rankings', () => {
    const legacyFriends = defaultFriends.map((friend) => {
      const legacy = { ...friend };
      delete legacy.travelMode;
      return legacy;
    });
    for (const strategy of ['balanced', 'total', 'fair'] as const) {
      expect(rankDistricts(legacyFriends, strategy)).toEqual(
        rankDistricts(defaultFriends, strategy),
      );
    }
    expect(planRoute(legacyFriends[0]!, district)).toBe(planRoute(defaultFriends[0]!, district));
    expect(planRoute(legacyFriends[0]!, district).travelMode).toBe('transit');
  });

  test('estimates road distance and driving time, then adds a separate five-minute walk', () => {
    const route = planRoute(driver, district);
    const estimatedDistance = distanceKm(driver.location, district.location) * 1.35;
    expect(route.source).toBe('estimate');
    expect(route.travelMode).toBe('driving');
    expect(route.distanceKm).toBeCloseTo(estimatedDistance, 8);
    expect(route.steps.map((step) => step.type)).toEqual(['drive', 'walk']);
    expect(route.steps[0]!.minutes).toBe(Math.max(1, Math.round((estimatedDistance / 30) * 60)));
    expect(route.steps[0]!.coordinates).toEqual([driver.location, district.location]);
    expect(route.steps[1]!.coordinates).toEqual([district.location]);
    expect(route.walkingMinutes).toBe(5);
    expect(route.transfers).toBe(0);
    expect(route.minutes).toBe(route.steps.reduce((sum, step) => sum + step.minutes, 0));
    const samePlace = planRoute({ ...driver, location: district.location }, district);
    expect(samePlace.minutes).toBe(6);
    expect(samePlace.steps[0]!.coordinates).toEqual([district.location]);
    expect(samePlace.distanceKm).toBe(0);
  });

  test('changing the mode bypasses cached transit routes and supports remote driving origins', () => {
    const transit = planRoute(defaultFriends[0]!, district);
    const driving = planRoute(driver, district);
    expect(driving).not.toBe(transit);
    expect(driving.steps[0]!.type).toBe('drive');
    expect(planRoute({ ...driver, travelMode: 'transit' }, district)).toBe(transit);
    const remote: Friend = { ...driver, location: { lng: 113.5, lat: 22.4 } };
    expect(planRoute({ ...remote, travelMode: 'transit' }, district).reachable).toBe(false);
    expect(
      rankDistricts([remote, defaultFriends[1]!], 'balanced').every((item) =>
        Number.isFinite(item.score),
      ),
    ).toBe(true);
    expect(planRoute({ ...remote, location: { lng: NaN, lat: 22.4 } }, district).reachable).toBe(
      false,
    );
  });

  test('API roads replace estimates without absorbing or drawing the arrival walk', () => {
    const estimated = planRoute(driver, district);
    const road = planRoute(driver, district, overrides);
    expect(road).not.toBe(estimated);
    expect(road.source).toBe('amap');
    expect(road.minutes).toBe(25);
    expect(road.distanceKm).toBe(12.3);
    expect(road.steps[0]!.coordinates).toEqual(roadData.coordinates);
    expect(road.steps[1]!.minutes).toBe(5);
    expect(road.steps[1]!.coordinates).toEqual([district.location]);
    expect(road.minutes).toBe(road.steps.reduce((sum, step) => sum + step.minutes, 0));
    expect(planRoute(driver, district)).toBe(estimated);
    expect(planRoute({ ...driver, weight: 0.2 }, district, overrides)).toBe(road);
    const refreshed = {
      [drivingOriginKey(driver.location)]: [{ ...roadData, minutes: 31.4 }],
    };
    expect(planRoute(driver, district, refreshed).minutes).toBe(36);
    expect(planRoute(driver, district, refreshed)).not.toBe(road);
    expect(planRoute(defaultFriends[0]!, district, overrides)).toBe(
      planRoute(defaultFriends[0]!, district),
    );
  });

  test('overrides follow exact coordinates, never friend IDs or a previous address', () => {
    const renamed = { ...driver, id: 'another-person', address: '同一位置的新名称' };
    expect(planRoute(renamed, district, overrides).source).toBe('amap');
    const moved = {
      ...driver,
      address: '新出发点',
      location: { ...driver.location, lng: driver.location.lng + 0.01 },
    };
    expect(drivingOriginKey(moved.location)).not.toBe(drivingOriginKey(driver.location));
    expect(planRoute(moved, district, overrides)).toBe(planRoute(moved, district));
    expect(planRoute(moved, district, overrides).source).toBe('estimate');
    expect(planRoute(driver, districts[1]!, overrides).source).toBe('estimate');
    const nearButDifferent = { ...driver.location, lng: driver.location.lng + 0.00000001 };
    expect(drivingOriginKey(nearButDifferent)).not.toBe(drivingOriginKey(driver.location));
  });

  test('invalid API fields fall back to the estimate and do not poison route caches', () => {
    const invalidCandidates: unknown[] = [
      null,
      { ...roadData, minutes: NaN },
      { ...roadData, minutes: Infinity },
      { ...roadData, minutes: -1 },
      { ...roadData, minutes: '20' },
      { ...roadData, distanceKm: -1 },
      { ...roadData, distanceKm: Infinity },
      { ...roadData, distanceKm: undefined },
      { ...roadData, coordinates: [] },
      { ...roadData, coordinates: null },
      { ...roadData, coordinates: [null] },
      { ...roadData, coordinates: [{ lng: 181, lat: 22.5 }] },
      { ...roadData, coordinates: [{ lng: 114, lat: NaN }] },
      { ...roadData, coordinates: [{ lng: '114', lat: 22.5 }] },
    ];
    const estimated = planRoute(driver, district);
    for (const candidate of invalidCandidates) {
      const invalid = { [drivingOriginKey(driver.location)]: [candidate] } as DrivingRouteOverrides;
      expect(planRoute(driver, district, invalid)).toBe(estimated);
    }
    const wrongList = { [drivingOriginKey(driver.location)]: {} } as DrivingRouteOverrides;
    expect(planRoute(driver, district, wrongList)).toBe(estimated);
    const withValidAlternative = {
      [drivingOriginKey(driver.location)]: [...invalidCandidates, roadData],
    } as DrivingRouteOverrides;
    expect(planRoute(driver, district, withValidAlternative).source).toBe('amap');
  });

  test('mixed-mode scores use each selected mode and each personal weight', () => {
    const friends = [defaultFriends[1]!, { ...driver, weight: 0.2 }];
    for (const strategy of ['balanced', 'total', 'fair'] as const) {
      const result = rankDistricts(friends, strategy, overrides);
      const item = result.find((candidate) => candidate.district.id === district.id)!;
      expect(item.routes[0]!.travelMode).toBe('transit');
      expect(item.routes[1]!.travelMode).toBe('driving');
      expect(item.routes[1]!.source).toBe('amap');
      expect(item.routes[1]!.minutes).toBe(25);
      const transitTime = item.routes[0]!.minutes;
      const mean = (transitTime + 25 * 0.2) / 1.2;
      const max = Math.max(transitTime / 0.6, (25 * 0.2) / 0.6);
      expect(item.score).toBeCloseTo(
        strategy === 'total'
          ? mean
          : strategy === 'fair'
            ? max + 0.1 * mean
            : 0.7 * mean + 0.3 * max,
        8,
      );
    }
  });

  test('driving weights change the winning district while retaining the same road calculations', () => {
    const drivers: Friend[] = [driver, { ...defaultFriends[1]!, travelMode: 'driving' }];
    const roadOverrides = Object.fromEntries(
      drivers.map((friend, personIndex) => [
        drivingOriginKey(friend.location),
        districts.map((destination, index) => ({
          districtId: destination.id,
          minutes: index < 2 ? (index === personIndex ? 10 : 50) : 90,
          distanceKm: 10,
          coordinates: [friend.location, destination.location],
        })),
      ]),
    );
    const westPriority = rankDistricts(
      [{ ...drivers[0]!, weight: 2 }, drivers[1]!],
      'balanced',
      roadOverrides,
    );
    const eastPriority = rankDistricts(
      [{ ...drivers[0]!, weight: 0.2 }, drivers[1]!],
      'balanced',
      roadOverrides,
    );
    expect(westPriority[0]!.district.id).toBe(districts[0]!.id);
    expect(eastPriority[0]!.district.id).toBe(districts[1]!.id);
    const sameDestination = eastPriority.find(
      (item) => item.district.id === westPriority[0]!.district.id,
    )!;
    expect(sameDestination.routes[0]).toBe(westPriority[0]!.routes[0]);
    expect(sameDestination.routes[1]).toBe(westPriority[0]!.routes[1]);
  });
});
