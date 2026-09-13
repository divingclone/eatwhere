import type { IncomingMessage, ServerResponse } from 'node:http';
import { districts } from '../src/lib/data.js';
import type { Coordinate, District } from '../src/lib/types';
import { gcj02ToWgs84, wgs84ToGcj02 } from '../server/coordinates.js';

/** Server only. Client code must call /api/driving rather than import this module. */
export interface DrivingRoute {
  districtId: string;
  /** Road travel only; the client adds its arrival walking allowance. */
  minutes: number;
  distanceKm: number;
  coordinates: Coordinate[];
}

type ErrorCode =
  | 'INVALID_ORIGIN'
  | 'INVALID_BODY'
  | 'METHOD_NOT_ALLOWED'
  | 'DRIVING_NOT_CONFIGURED'
  | 'DRIVING_CONFIGURATION_ERROR'
  | 'DRIVING_RATE_LIMITED'
  | 'DRIVING_TIMEOUT'
  | 'DRIVING_UNAVAILABLE';

interface ApiResult {
  status: number;
  body: { routes: DrivingRoute[] } | { error: { code: ErrorCode; message: string } };
}

class ProviderError extends Error {
  constructor(public readonly result: ApiResult) {
    super('Driving provider request failed');
  }
}

function error(status: number, code: ErrorCode, message: string): ApiResult {
  return { status, body: { error: { code, message } } };
}

const unavailable = () => error(502, 'DRIVING_UNAVAILABLE', '驾车路线服务暂时不可用，请稍后重试。');
const timedOut = () => error(504, 'DRIVING_TIMEOUT', '驾车路线查询超时，请稍后重试。');
const rateLimited = () =>
  error(429, 'DRIVING_RATE_LIMITED', '驾车路线请求过于频繁或额度已用完，请稍后重试。');

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function originFromBody(body: unknown): Coordinate | undefined {
  const payload = object(body);
  const origin = object(payload?.origin);
  if (!payload || Object.keys(payload).length !== 1 || !origin || Object.keys(origin).length !== 2)
    return undefined;
  const { lng, lat } = origin;
  if (
    typeof lng !== 'number' ||
    typeof lat !== 'number' ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    lng < 113.7 ||
    lng > 114.65 ||
    lat < 22.38 ||
    lat > 22.9
  )
    return undefined;
  return { lng, lat };
}

// This limit is shared by all origin requests in one server instance.
let activeRequests = 0;
const slotQueue: Array<() => void> = [];

function acquireSlot(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = slotQueue.indexOf(start);
      if (index >= 0) slotQueue.splice(index, 1);
      reject(new Error('Driving request aborted'));
    };
    const start = () => {
      signal.removeEventListener('abort', abort);
      activeRequests += 1;
      resolve(() => {
        activeRequests -= 1;
        slotQueue.shift()?.();
      });
    };
    if (signal.aborted) return abort();
    if (activeRequests < 3) start();
    else {
      signal.addEventListener('abort', abort, { once: true });
      slotQueue.push(start);
    }
  });
}

function numeric(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function parsePath(value: unknown, districtId: string): DrivingRoute | undefined {
  const path = object(value);
  const duration = numeric(path?.duration);
  const distance = numeric(path?.distance);
  if (
    duration === undefined ||
    duration > 86_400 ||
    distance === undefined ||
    distance > 500_000 ||
    !Array.isArray(path?.steps) ||
    path.steps.length === 0
  )
    return undefined;
  const coordinates: Coordinate[] = [];
  let previous = '';
  for (const rawStep of path.steps) {
    const polyline = object(rawStep)?.polyline;
    // Reject an incomplete route instead of drawing a straight segment over missing roads.
    if (typeof polyline !== 'string' || !polyline || polyline.length > 500_000) return undefined;
    for (const point of polyline.split(';')) {
      const parts = point.split(',');
      if (parts.length !== 2) return undefined;
      const lng = numeric(parts[0]);
      const lat = numeric(parts[1]);
      // Allow nearby roads outside the city bounds, but reject unrelated provider coordinates.
      if (
        lng === undefined ||
        lat === undefined ||
        lng < 113.5 ||
        lng > 115 ||
        lat < 22.2 ||
        lat > 23.3
      )
        return undefined;
      if (point !== previous) coordinates.push(gcj02ToWgs84({ lng, lat }));
      previous = point;
      if (coordinates.length > 20_000) return undefined;
    }
  }
  if (coordinates.length < 2) return undefined;
  return { districtId, minutes: duration / 60, distanceKm: distance / 1000, coordinates };
}

function providerFailure(code: unknown): ApiResult {
  if (
    [
      '10003',
      '10004',
      '10010',
      '10014',
      '10015',
      '10019',
      '10020',
      '10021',
      '10029',
      '10044',
      '10045',
      '40000',
      '40003',
    ].includes(String(code))
  )
    return rateLimited();
  if (
    [
      '10001',
      '10002',
      '10005',
      '10006',
      '10007',
      '10008',
      '10009',
      '10012',
      '10013',
      '10026',
      '10041',
      '40002',
    ].includes(String(code))
  )
    return error(
      503,
      'DRIVING_CONFIGURATION_ERROR',
      '驾车路线服务配置不可用，请站点管理员检查高德 Web 服务 Key 和接口权限。',
    );
  return unavailable();
}

function providerCoordinate(location: Coordinate): string {
  const converted = wgs84ToGcj02(location);
  return `${converted.lng.toFixed(6)},${converted.lat.toFixed(6)}`;
}

async function requestDistrict(
  origin: Coordinate,
  district: District,
  key: string,
  batchSignal: AbortSignal,
): Promise<DrivingRoute> {
  const release = await acquireSlot(batchSignal);
  const signal = AbortSignal.any([batchSignal, AbortSignal.timeout(5_000)]);
  try {
    // Fixed provider, path and destination catalog; client data cannot select an upstream URL.
    const url = new URL('https://restapi.amap.com/v3/direction/driving');
    url.search = new URLSearchParams({
      origin: providerCoordinate(origin),
      destination: providerCoordinate(district.location),
      strategy: '10',
      extensions: 'base',
      output: 'JSON',
      key,
    }).toString();
    const response = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
      redirect: 'error',
    });
    if (response.status === 429) throw new ProviderError(rateLimited());
    if (!response.ok) throw new ProviderError(unavailable());
    const data = object(await response.json());
    if (!data) throw new ProviderError(unavailable());
    if (data.status !== '1') throw new ProviderError(providerFailure(data.infocode));
    const paths = object(data.route)?.paths;
    if (Array.isArray(paths)) {
      for (const path of paths) {
        const parsed = parsePath(path, district.id);
        if (parsed) return parsed;
      }
    }
    throw new ProviderError(unavailable());
  } catch (cause) {
    if (signal.aborted) throw new ProviderError(timedOut());
    throw cause;
  } finally {
    release();
  }
}

async function requestRoutes(origin: Coordinate, key: string): Promise<ApiResult> {
  const signal = AbortSignal.timeout(22_000);
  const routes = new Map<string, DrivingRoute>();
  const failures: ApiResult[] = [];
  let next = 0;
  let stop = false;
  async function worker() {
    while (!stop && !signal.aborted && next < districts.length) {
      const district = districts[next++];
      try {
        const route = await requestDistrict(origin, district, key, signal);
        routes.set(district.id, route);
      } catch (cause) {
        const failure =
          cause instanceof ProviderError
            ? cause.result
            : signal.aborted
              ? timedOut()
              : unavailable();
        failures.push(failure);
        // A quota/key rejection applies to every destination; avoid spending the rest of the batch.
        if (failure.status === 429 || failure.status === 503) stop = true;
      }
    }
  }
  await Promise.all(Array.from({ length: 3 }, () => worker()));
  if (routes.size > 0)
    return {
      status: 200,
      body: { routes: districts.flatMap((district) => routes.get(district.id) ?? []) },
    };
  return (
    failures.find((failure) => failure.status === 429 || failure.status === 503) ??
    (signal.aborted ? timedOut() : (failures[0] ?? unavailable()))
  );
}

/** A separate service instance makes cache behavior testable without using a real provider key. */
export function createDrivingService(): (body: unknown) => Promise<ApiResult> {
  const cache = new Map<string, { expires: number; result: ApiResult; points: number }>();
  let cachedPoints = 0;
  function evict(id: string) {
    cachedPoints -= cache.get(id)?.points ?? 0;
    cache.delete(id);
  }
  const pending = new Map<string, Promise<ApiResult>>();
  return async (body: unknown) => {
    const origin = originFromBody(body);
    if (!origin) return error(400, 'INVALID_ORIGIN', '请提供有效的深圳出发地经纬度。');
    const key = process.env.AMAP_WEB_SERVICE_KEY?.trim();
    if (!key)
      return error(
        503,
        'DRIVING_NOT_CONFIGURED',
        '尚未开通驾车路线查询，请站点管理员配置高德 Web 服务 Key。',
      );
    const cacheKey = `${origin.lng.toFixed(6)},${origin.lat.toFixed(6)}`;
    const now = Date.now();
    for (const [id, entry] of cache) if (entry.expires <= now) evict(id);
    const cached = cache.get(cacheKey);
    if (cached) return structuredClone(cached.result);
    const existing = pending.get(cacheKey);
    if (existing) return structuredClone(await existing);
    if (pending.size >= 32) return rateLimited();
    const request = requestRoutes(origin, key);
    pending.set(cacheKey, request);
    try {
      const result = await request;
      if (result.status === 200 && 'routes' in result.body) {
        const ttl = result.body.routes.length === districts.length ? 300_000 : 15_000;
        const points = result.body.routes.reduce(
          (total, route) => total + route.coordinates.length,
          0,
        );
        cache.set(cacheKey, { result, points, expires: Date.now() + ttl });
        cachedPoints += points;
        while (cache.size > 64 || cachedPoints > 200_000) evict(cache.keys().next().value!);
      }
      return structuredClone(result);
    } finally {
      pending.delete(cacheKey);
    }
  };
}

export const drivingRequest = createDrivingService();

function parseBodyText(text: string): unknown {
  if (Buffer.byteLength(text) > 1024) throw new Error('Invalid body');
  const body: unknown = JSON.parse(text);
  // This small schema has exactly three distinct keys. Reject duplicate JSON members,
  // including escaped spellings, before JSON.parse's last-value-wins behavior can hide them.
  const keys = [...text.matchAll(/("(?:\\.|[^"\\])*")\s*:/g)].map((match) => JSON.parse(match[1]));
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate body member');
  return body;
}

async function readBody(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType))
    throw new Error('Invalid content type');
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > 1024))
    throw new Error('Invalid body size');
  // Vercel may provide a parsed body; Vite provides the request stream.
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return parseBodyText(req.body);
    if (Buffer.isBuffer(req.body)) return parseBodyText(req.body.toString('utf8'));
    return req.body;
  }
  return new Promise((resolve, reject) => {
    let text = '';
    let bytes = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onError);
    };
    const onError = () => {
      cleanup();
      reject(new Error('Invalid body'));
    };
    const onData = (chunk: Buffer | string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1024) {
        onError();
        req.resume();
        return;
      }
      text += chunk.toString();
    };
    const onEnd = () => {
      cleanup();
      try {
        resolve(parseBodyText(text));
      } catch {
        reject(new Error('Invalid body'));
      }
    };
    const timer = setTimeout(onError, 5_000);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onError);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  let result: ApiResult;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    result = error(405, 'METHOD_NOT_ALLOWED', '驾车路线查询仅支持 POST 请求。');
  } else {
    try {
      if (new URL(req.url ?? '/', 'http://localhost').search) throw new Error('Unexpected query');
      result = await drivingRequest(await readBody(req));
    } catch {
      result = error(400, 'INVALID_BODY', '请使用 JSON 提供一个有效的出发地。');
    }
  }
  res.statusCode = result.status;
  res.end(JSON.stringify(result.body));
}
