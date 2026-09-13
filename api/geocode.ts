import type { IncomingMessage, ServerResponse } from 'node:http';

/** This module is server-only. Never import it from src/. */
export interface AddressResult {
  id: string;
  name: string;
  address: string;
  location: { lng: number; lat: number };
}

type ErrorCode =
  | 'INVALID_QUERY'
  | 'METHOD_NOT_ALLOWED'
  | 'GEOCODING_NOT_CONFIGURED'
  | 'GEOCODING_CONFIGURATION_ERROR'
  | 'GEOCODING_RATE_LIMITED'
  | 'GEOCODING_TIMEOUT'
  | 'GEOCODING_UNAVAILABLE';

interface ApiResult {
  status: number;
  body: { results: AddressResult[] } | { error: { code: ErrorCode; message: string } };
}

class ProviderError extends Error {
  constructor(public readonly result: ApiResult) {
    super('Geocoding provider request failed');
  }
}

function error(status: number, code: ErrorCode, message: string): ApiResult {
  return { status, body: { error: { code, message } } };
}

function field(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// Amap uses GCJ-02; our Leaflet basemap and metro graph use WGS84.
// Iteratively invert the standard mainland offset rather than subtract it once.
function toWgs84(lng: number, lat: number): { lng: number; lat: number } {
  const a = 6378245;
  const ee = 0.006693421622965943;
  const offset = (x: number, y: number) => {
    let dLat = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    let dLng = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    const common = ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
    dLat += common + ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
    dLat += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
    dLng += common + ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
    dLng += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
    return { dLat, dLng };
  };

  let resultLng = lng;
  let resultLat = lat;
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const { dLat, dLng } = offset(resultLng - 105, resultLat - 35);
    const rad = (resultLat / 180) * Math.PI;
    const magic = 1 - ee * Math.sin(rad) ** 2;
    const sqrtMagic = Math.sqrt(magic);
    const latOffset = (dLat * 180) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
    const lngOffset = (dLng * 180) / ((a / sqrtMagic) * Math.cos(rad) * Math.PI);
    const deltaLng = resultLng + lngOffset - lng;
    const deltaLat = resultLat + latOffset - lat;
    resultLng -= deltaLng;
    resultLat -= deltaLat;
    if (Math.max(Math.abs(deltaLng), Math.abs(deltaLat)) < 1e-8) break;
  }
  return { lng: resultLng, lat: resultLat };
}

function parseLocation(value: unknown, adcode: unknown): AddressResult['location'] | undefined {
  if (!/^4403\d{2}$/.test(field(adcode))) return undefined;
  const parts = field(value).split(',');
  if (parts.length !== 2 || parts.some((part) => part.trim() === '')) return undefined;
  const [lng, lat] = parts.map(Number);
  // Extra bounds protect the routing engine from malformed provider data.
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    lng < 113.7 ||
    lng > 114.65 ||
    lat < 22.38 ||
    lat > 22.9
  )
    return undefined;
  return toWgs84(lng, lat);
}

async function requestAmap(
  path: 'place/text' | 'geocode/geo',
  params: Record<string, string>,
  key: string,
  signal: AbortSignal,
) {
  // Both host and paths are fixed: user input is only a query parameter.
  const url = new URL(`https://restapi.amap.com/v3/${path}`);
  url.search = new URLSearchParams({ ...params, key, output: 'JSON' }).toString();
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
    redirect: 'error',
  });
  if (response.status === 429) {
    throw new ProviderError(
      error(429, 'GEOCODING_RATE_LIMITED', '地址搜索请求过于频繁或额度已用完，请稍后重试。'),
    );
  }
  if (!response.ok) throw new Error('Geocoding upstream unavailable');
  const data = object(await response.json());
  if (!data) throw new Error('Invalid geocoding response');
  if (field(data.status) !== '1') {
    const code = field(data.infocode);
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
      ].includes(code)
    ) {
      throw new ProviderError(
        error(429, 'GEOCODING_RATE_LIMITED', '地址搜索请求过于频繁或额度已用完，请稍后重试。'),
      );
    }
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
      ].includes(code)
    ) {
      throw new ProviderError(
        error(
          503,
          'GEOCODING_CONFIGURATION_ERROR',
          '地址搜索服务配置不可用，请站点管理员检查高德 Web 服务 Key 和接口权限。',
        ),
      );
    }
    throw new Error('Geocoding provider rejected request');
  }
  return data;
}

/** Shared by the Vercel function and the local Vite development middleware. */
export async function geocodeRequest(query: string): Promise<ApiResult> {
  if (
    typeof query !== 'string' ||
    query.trim().length < 2 ||
    query.trim().length > 100 ||
    /[\u0000-\u001f\u007f]/.test(query)
  ) {
    return error(400, 'INVALID_QUERY', '请输入 2–100 个字符的深圳地址或地点名称。');
  }
  const key = process.env.AMAP_WEB_SERVICE_KEY?.trim();
  if (!key) {
    return error(
      503,
      'GEOCODING_NOT_CONFIGURED',
      '尚未开通详细地址搜索，可先选择内置地铁站和商圈；站点管理员配置高德 Web 服务 Key 后即可搜索深圳地址。',
    );
  }

  const normalizedQuery = query.trim();
  const timeout = AbortSignal.timeout(8_000);
  try {
    const data = await requestAmap(
      'place/text',
      {
        keywords: normalizedQuery,
        city: '440300',
        citylimit: 'true',
        offset: '6',
        page: '1',
        extensions: 'base',
      },
      key,
      timeout,
    );
    const results: AddressResult[] = [];
    const seen = new Set<string>();
    for (const raw of Array.isArray(data.pois) ? data.pois : []) {
      const poi = object(raw);
      if (!poi) continue;
      const location = parseLocation(poi.location, poi.adcode);
      const name = field(poi.name);
      if (!location || !name) continue;
      const id = `amap:${field(poi.id) || `${location.lng.toFixed(6)},${location.lat.toFixed(6)}:${name}`}`;
      if (seen.has(id)) continue;
      seen.add(id);
      results.push({
        id,
        name,
        address: [field(poi.cityname), field(poi.adname), field(poi.address)]
          .filter(Boolean)
          .join(''),
        location,
      });
      if (results.length === 6) break;
    }

    if (results.length === 0) {
      const geocoded = await requestAmap(
        'geocode/geo',
        { address: normalizedQuery, city: '440300' },
        key,
        timeout,
      );
      for (const raw of Array.isArray(geocoded.geocodes) ? geocoded.geocodes : []) {
        const candidate = object(raw);
        if (!candidate) continue;
        // A city/district centroid is not an address match.
        if (['国家', '省', '市', '区县'].includes(field(candidate.level))) continue;
        const location = parseLocation(candidate.location, candidate.adcode);
        if (!location) continue;
        const address = field(candidate.formatted_address);
        if (!address) continue;
        results.push({
          id: `amap:geo:${location.lng.toFixed(6)},${location.lat.toFixed(6)}`,
          name: normalizedQuery,
          address,
          location,
        });
        if (results.length >= 6) break;
      }
    }
    return { status: 200, body: { results } };
  } catch (cause) {
    if (cause instanceof ProviderError) return cause.result;
    if (timeout.aborted)
      return error(504, 'GEOCODING_TIMEOUT', '地址搜索超时，请稍后重试，或先选择附近的地铁站。');
    return error(
      502,
      'GEOCODING_UNAVAILABLE',
      '地址搜索服务暂时不可用，请稍后重试，或先选择附近的地铁站。',
    );
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    const result = error(405, 'METHOD_NOT_ALLOWED', '地址搜索仅支持 GET 请求。');
    res.statusCode = result.status;
    res.end(JSON.stringify(result.body));
    return;
  }
  const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const query = params.getAll('q');
  const result = await geocodeRequest(query.length === 1 ? query[0] : '');
  res.statusCode = result.status;
  res.end(JSON.stringify(result.body));
}
