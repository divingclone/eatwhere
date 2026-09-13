import { districts, metroLines, metroStations } from './data';
import type {
  Coordinate,
  District,
  Friend,
  MetroLine,
  MetroStation,
  PersonRoute,
  Recommendation,
  RouteStep,
} from './types';

/** Transparent, deliberately approximate assumptions; no timetable or live service data. */
export const routingAssumptions = {
  maxAccessDistanceKm: 1.6,
  maxAccessStations: 6,
  walkingDetourFactor: 1.25,
  walkingSpeedKmh: 4.6,
  stationEntryMinutes: 2,
  stationExitMinutes: 2,
  initialWaitMinutes: 3,
  transferMinutes: 6,
  largeHubTransferMinutes: 8,
  regularSpeedKmh: 42,
  expressSpeedKmh: 62,
  perStopMinutes: 1,
} as const;

export function distanceKm(a: Coordinate, b: Coordinate): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (b.lat - a.lat) * radians;
  const longitudeDelta = (b.lng - a.lng) * radians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
}

type Edge = { to: string; minutes: number; type: 'metro' | 'transfer' };
type State = { station: MetroStation; line: MetroLine; edges: Edge[] };
type OriginTree = {
  costs: Map<string, number>;
  previous: Map<string, { from: string; edge: Edge }>;
  roots: Map<string, MetroStation>;
};

const stationsById = new Map(metroStations.map((station) => [station.id, station]));
const states = new Map<string, State>();
const largeHubs = new Set(['深圳北站', '岗厦北', '福田', '车公庙', '布吉', '大运']);
const stateKey = (stationId: string, lineId: string) => `${stationId}|${lineId}`;
const stationLabel = (name: string) => (name.endsWith('站') ? name : `${name}站`);

for (const line of metroLines) {
  for (const stationId of line.stationIds) {
    const station = stationsById.get(stationId);
    if (station) states.set(stateKey(stationId, line.id), { station, line, edges: [] });
  }
  for (let index = 1; index < line.stationIds.length; index += 1) {
    const fromKey = stateKey(line.stationIds[index - 1]!, line.id);
    const toKey = stateKey(line.stationIds[index]!, line.id);
    const from = states.get(fromKey)!;
    const to = states.get(toKey)!;
    const speed = ['11', '14'].includes(line.id)
      ? routingAssumptions.expressSpeedKmh
      : routingAssumptions.regularSpeedKmh;
    const minutes = Math.max(
      1.8,
      (distanceKm(from.station.location, to.station.location) / speed) * 60 +
        routingAssumptions.perStopMinutes,
    );
    from.edges.push({ to: toKey, minutes, type: 'metro' });
    to.edges.push({ to: fromKey, minutes, type: 'metro' });
  }
}

for (const station of metroStations) {
  for (const fromLine of station.lineIds) {
    for (const toLine of station.lineIds) {
      if (fromLine === toLine) continue;
      states.get(stateKey(station.id, fromLine))!.edges.push({
        to: stateKey(station.id, toLine),
        type: 'transfer',
        minutes: largeHubs.has(station.name)
          ? routingAssumptions.largeHubTransferMinutes
          : routingAssumptions.transferMinutes,
      });
    }
  }
}

class MinHeap {
  private values: { key: string; cost: number }[] = [];

  push(value: { key: string; cost: number }): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.values[parent]!.cost <= value.cost) break;
      this.values[index] = this.values[parent]!;
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): { key: string; cost: number } | undefined {
    const result = this.values[0];
    const last = this.values.pop();
    if (!last || this.values.length === 0) return result;
    let index = 0;
    while (index * 2 + 1 < this.values.length) {
      let child = index * 2 + 1;
      if (child + 1 < this.values.length && this.values[child + 1]!.cost < this.values[child]!.cost)
        child += 1;
      if (last.cost <= this.values[child]!.cost) break;
      this.values[index] = this.values[child]!;
      index = child;
    }
    this.values[index] = last;
    return result;
  }
}

function walkingMinutes(distance: number): number {
  return (
    ((distance * routingAssumptions.walkingDetourFactor) / routingAssumptions.walkingSpeedKmh) * 60
  );
}

function nearbyStations(point: Coordinate): { station: MetroStation; distance: number }[] {
  return metroStations
    .map((station) => ({ station, distance: distanceKm(point, station.location) }))
    .filter(({ distance }) => distance <= routingAssumptions.maxAccessDistanceKm)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, routingAssumptions.maxAccessStations);
}

const originCache = new Map<string, OriginTree>();
const routeCache = new Map<string, PersonRoute>();

function cacheSet<T>(cache: Map<string, T>, key: string, value: T, limit: number): void {
  if (cache.size >= limit) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
}

function getOriginTree(location: Coordinate): OriginTree {
  const cacheKey = `${location.lng},${location.lat}`;
  const cached = originCache.get(cacheKey);
  if (cached) return cached;
  const tree: OriginTree = { costs: new Map(), previous: new Map(), roots: new Map() };
  const queue = new MinHeap();
  for (const { station, distance } of nearbyStations(location)) {
    for (const lineId of station.lineIds) {
      const key = stateKey(station.id, lineId);
      const cost =
        walkingMinutes(distance) +
        routingAssumptions.stationEntryMinutes +
        routingAssumptions.initialWaitMinutes;
      tree.costs.set(key, cost);
      tree.roots.set(key, station);
      queue.push({ key, cost });
    }
  }
  let current = queue.pop();
  while (current) {
    if (current.cost > tree.costs.get(current.key)!) {
      current = queue.pop();
      continue;
    }
    for (const edge of states.get(current.key)!.edges) {
      const cost = current.cost + edge.minutes;
      if (cost < (tree.costs.get(edge.to) ?? Infinity)) {
        tree.costs.set(edge.to, cost);
        tree.previous.set(edge.to, { from: current.key, edge });
        tree.roots.delete(edge.to);
        queue.push({ key: edge.to, cost });
      }
    }
    current = queue.pop();
  }
  cacheSet(originCache, cacheKey, tree, 128);
  return tree;
}

function combineCoordinates(steps: RouteStep[]): Coordinate[] {
  const coordinates: Coordinate[] = [];
  for (const step of steps) {
    for (const coordinate of step.coordinates) {
      const last = coordinates.at(-1);
      if (!last || last.lng !== coordinate.lng || last.lat !== coordinate.lat)
        coordinates.push(coordinate);
    }
  }
  return coordinates;
}

function fromSteps(friendId: string, steps: RouteStep[]): PersonRoute {
  // Round each displayed step once, then sum; the timeline always adds up to the headline.
  const roundedSteps = steps.map((step) => ({
    ...step,
    minutes: Math.max(1, Math.round(step.minutes)),
  }));
  return {
    friendId,
    minutes: roundedSteps.reduce((sum, step) => sum + step.minutes, 0),
    walkingMinutes: roundedSteps
      .filter((step) => step.type === 'walk')
      .reduce((sum, step) => sum + step.minutes, 0),
    transfers: roundedSteps.filter((step) => step.type === 'transfer').length,
    steps: roundedSteps,
    coordinates: combineCoordinates(roundedSteps),
    reachable: true,
  };
}

function isValidLocation(location: Coordinate): boolean {
  return (
    Number.isFinite(location?.lng) &&
    Number.isFinite(location?.lat) &&
    Math.abs(location.lng) <= 180 &&
    Math.abs(location.lat) <= 90
  );
}

function unreachable(friendId: string): PersonRoute {
  return {
    friendId,
    minutes: Infinity,
    walkingMinutes: 0,
    transfers: 0,
    steps: [],
    coordinates: [],
    reachable: false,
  };
}

export function planRoute(friend: Friend, district: District): PersonRoute {
  if (!isValidLocation(friend.location) || !isValidLocation(district.location))
    return unreachable(friend.id);
  const cacheKey = `${friend.id}|${friend.address}|${friend.location.lng},${friend.location.lat}|${district.id}|${district.name}|${district.location.lng},${district.location.lat}`;
  const cached = routeCache.get(cacheKey);
  if (cached) return cached;

  const directDistance = distanceKm(friend.location, district.location);
  const directCost =
    directDistance <= routingAssumptions.maxAccessDistanceKm
      ? walkingMinutes(directDistance)
      : Infinity;
  let bestCost = directCost;
  let endKey: string | undefined;
  const tree = getOriginTree(friend.location);
  for (const { station, distance } of nearbyStations(district.location)) {
    for (const lineId of station.lineIds) {
      const key = stateKey(station.id, lineId);
      // A source and destination near the same station must not be presented as a
      // metro trip without boarding. Direct walking is evaluated separately.
      if (!tree.previous.has(key)) continue;
      const cost =
        (tree.costs.get(key) ?? Infinity) +
        walkingMinutes(distance) +
        routingAssumptions.stationExitMinutes;
      if (cost < bestCost) {
        bestCost = cost;
        endKey = key;
      }
    }
  }

  if (!Number.isFinite(bestCost)) {
    const route = unreachable(friend.id);
    cacheSet(routeCache, cacheKey, route, 2048);
    return route;
  }
  if (!endKey) {
    const route = fromSteps(friend.id, [
      {
        type: 'walk',
        label: `步行到${district.name}`,
        minutes: directCost,
        from: friend.address,
        to: district.name,
        coordinates: [friend.location, district.location],
      },
    ]);
    cacheSet(routeCache, cacheKey, route, 2048);
    return route;
  }

  const path: { from: string; to: string; edge: Edge }[] = [];
  let key = endKey;
  while (tree.previous.has(key)) {
    const previous = tree.previous.get(key)!;
    path.push({ from: previous.from, to: key, edge: previous.edge });
    key = previous.from;
  }
  path.reverse();
  const firstStation = states.get(key)!.station;
  const finalStation = states.get(endKey)!.station;
  const steps: RouteStep[] = [
    {
      type: 'walk',
      label: `步行至${stationLabel(firstStation.name)} · 含进站约 2 分钟`,
      minutes:
        walkingMinutes(distanceKm(friend.location, firstStation.location)) +
        routingAssumptions.stationEntryMinutes,
      from: friend.address,
      to: firstStation.name,
      coordinates: [friend.location, firstStation.location],
    },
  ];
  let firstBoarding = true;
  for (const segment of path) {
    const from = states.get(segment.from)!;
    const to = states.get(segment.to)!;
    if (segment.edge.type === 'transfer') {
      steps.push({
        type: 'transfer',
        label: `${stationLabel(from.station.name)}换乘${to.line.name} · 含候车`,
        minutes: segment.edge.minutes,
        lineId: to.line.id,
        lineName: to.line.name,
        color: to.line.color,
        from: from.station.name,
        to: to.station.name,
        coordinates: [from.station.location],
      });
      continue;
    }
    const last = steps.at(-1)!;
    if (last.type === 'metro' && last.lineId === from.line.id) {
      last.minutes += segment.edge.minutes;
      last.to = to.station.name;
      last.stops = (last.stops ?? 0) + 1;
      last.coordinates.push(to.station.location);
    } else {
      steps.push({
        type: 'metro',
        label: `${from.line.name}${firstBoarding ? ' · 含候车约 3 分钟' : ''}`,
        minutes: segment.edge.minutes + (firstBoarding ? routingAssumptions.initialWaitMinutes : 0),
        lineId: from.line.id,
        lineName: from.line.name,
        color: from.line.color,
        from: from.station.name,
        to: to.station.name,
        stops: 1,
        coordinates: [from.station.location, to.station.location],
      });
      firstBoarding = false;
    }
  }
  steps.push({
    type: 'walk',
    label: `出站步行至${district.name} · 含出站约 2 分钟`,
    minutes:
      walkingMinutes(distanceKm(finalStation.location, district.location)) +
      routingAssumptions.stationExitMinutes,
    from: finalStation.name,
    to: district.name,
    coordinates: [finalStation.location, district.location],
  });
  const route = fromSteps(friend.id, steps);
  cacheSet(routeCache, cacheKey, route, 2048);
  return route;
}

export function rankDistricts(
  friends: Friend[],
  strategy: 'balanced' | 'total' | 'fair',
): Recommendation[] {
  if (friends.length === 0) return [];
  const weights = friends.map((friend) =>
    Number.isFinite(friend.weight) ? Math.max(0.1, friend.weight) : 1,
  );
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const averageWeight = weightSum / friends.length;
  return districts
    .map((district): Recommendation => {
      const routes = friends.map((friend) => planRoute(friend, district));
      if (routes.some((route) => !route.reachable)) {
        return {
          district,
          routes,
          score: Infinity,
          averageMinutes: Infinity,
          maxMinutes: Infinity,
          spread: Infinity,
        };
      }
      const times = routes.map((route) => route.minutes);
      const weightedMean =
        times.reduce((sum, minutes, index) => sum + minutes * weights[index]!, 0) / weightSum;
      const weightedMax = Math.max(
        ...times.map((minutes, index) => (minutes * weights[index]!) / averageWeight),
      );
      const score =
        strategy === 'total'
          ? weightedMean
          : strategy === 'fair'
            ? weightedMax + 0.1 * weightedMean
            : 0.7 * weightedMean + 0.3 * weightedMax;
      return {
        district,
        routes,
        score,
        averageMinutes: Math.round(times.reduce((sum, minutes) => sum + minutes, 0) / times.length),
        maxMinutes: Math.max(...times),
        spread: Math.max(...times) - Math.min(...times),
      };
    })
    .sort((a, b) => {
      if (a.score === b.score) return a.district.id.localeCompare(b.district.id);
      return a.score < b.score ? -1 : 1;
    });
}
