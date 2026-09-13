import { districts } from './data';
import { drivingOriginKey } from './routing';
import type { Coordinate, DrivingRouteData, DrivingRouteOverrides } from './types';

const cache = new Map<string, { expires: number; routes: DrivingRouteData[] }>();
const districtIds = new Set(districts.map((district) => district.id));
const cacheTtl = 5 * 60_000;

export class DrivingRouteError extends Error {
  constructor(
    message: string,
    public readonly code = 'DRIVING_UNAVAILABLE',
  ) {
    super(message);
    this.name = 'DrivingRouteError';
  }
}

function validRoute(route: DrivingRouteData): boolean {
  return (
    districtIds.has(route?.districtId) &&
    Number.isFinite(route.minutes) &&
    route.minutes > 0 &&
    route.minutes <= 1440 &&
    Number.isFinite(route.distanceKm) &&
    route.distanceKm >= 0 &&
    route.distanceKm <= 1000 &&
    Array.isArray(route.coordinates) &&
    route.coordinates.length >= 2 &&
    route.coordinates.length <= 30_000 &&
    route.coordinates.every(
      (point) =>
        Number.isFinite(point?.lng) &&
        Number.isFinite(point?.lat) &&
        Math.abs(point.lng) <= 180 &&
        Math.abs(point.lat) <= 90,
    )
  );
}

export async function fetchDrivingRoutes(
  origin: Coordinate,
  signal: AbortSignal,
  refresh = false,
): Promise<DrivingRouteData[]> {
  signal.throwIfAborted();
  const key = drivingOriginKey(origin);
  const cached = cache.get(key);
  if (!refresh && cached && cached.expires > Date.now()) return cached.routes;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 35_000);
  try {
    const response = await fetch('/api/driving', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin }),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new DrivingRouteError('驾车路线服务暂不可用，当前使用粗略估算。');
    const data = await response.json();
    if (!response.ok) {
      throw new DrivingRouteError(
        typeof data?.error?.message === 'string'
          ? data.error.message
          : '驾车路线暂不可用，当前使用粗略估算。',
        typeof data?.error?.code === 'string' ? data.error.code : undefined,
      );
    }
    if (!Array.isArray(data?.routes)) throw new DrivingRouteError('驾车路线返回异常。');
    const routes = Array.from(
      new Map<string, DrivingRouteData>(
        data.routes
          .filter(validRoute)
          .map((route: DrivingRouteData) => [route.districtId, route] as const),
      ).values(),
    );
    if (!routes.length) throw new DrivingRouteError('暂未取得道路路线，当前使用粗略估算。');
    signal.throwIfAborted();
    // Only complete results are cached; retry can fill any missing districts.
    if (routes.length === districts.length) {
      if (cache.size >= 32) cache.delete(cache.keys().next().value!);
      cache.set(key, { routes, expires: Date.now() + cacheTtl });
    }
    return routes;
  } catch (cause) {
    signal.throwIfAborted();
    if (timedOut) throw new DrivingRouteError('驾车估时超时，当前使用粗略估算。');
    if (cause instanceof DrivingRouteError) throw cause;
    throw new DrivingRouteError('无法连接驾车路线服务，当前使用粗略估算。');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** Two origin batches at a time; changing mode/location cancels obsolete work. */
export async function loadDrivingRoutes(
  origins: Coordinate[],
  signal: AbortSignal,
  refresh = false,
): Promise<{ routes: DrivingRouteOverrides; errors: string[] }> {
  const uniqueOrigins = Array.from(
    new Map(origins.map((origin) => [drivingOriginKey(origin), origin])).values(),
  );
  const routes: DrivingRouteOverrides = {};
  const errors: string[] = [];
  let cursor = 0;
  let stopRequests = false;
  async function worker() {
    while (cursor < uniqueOrigins.length && !stopRequests) {
      signal.throwIfAborted();
      const origin = uniqueOrigins[cursor++]!;
      try {
        routes[drivingOriginKey(origin)] = await fetchDrivingRoutes(origin, signal, refresh);
        if (routes[drivingOriginKey(origin)]!.length < districts.length)
          errors.push('部分商圈暂未取得道路路线，已用粗略估算补全。');
      } catch (cause) {
        signal.throwIfAborted();
        const error = cause as DrivingRouteError;
        errors.push(error.message);
        stopRequests = /NOT_CONFIGURED|CONFIGURATION|RATE_LIMIT/.test(error.code ?? '');
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, uniqueOrigins.length) }, () => worker()));
  signal.throwIfAborted();
  return { routes, errors: [...new Set(errors)] };
}
