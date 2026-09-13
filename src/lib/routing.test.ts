import { describe, expect, test } from 'bun:test';
import { dataInfo, defaultFriends, districts, metroLines, metroStations } from './data';
import { distanceKm, planRoute, rankDistricts, routingAssumptions } from './routing';
import type { Friend } from './types';

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
    expect(rankDistricts([remote], 'balanced').every((item) => item.score === Infinity)).toBe(true);
    expect(
      planRoute({ ...remote, location: { lng: NaN, lat: 22.5 } }, districts[0]!).reachable,
    ).toBe(false);
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
