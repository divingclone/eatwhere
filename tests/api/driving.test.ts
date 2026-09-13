import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import handler, { createDrivingService } from '../../api/driving';
import { districts } from '../../src/lib/data';
import { gcj02ToWgs84, wgs84ToGcj02 } from '../../server/coordinates';

const originalFetch = globalThis.fetch;
const originalKey = process.env.AMAP_WEB_SERVICE_KEY;
const testKey = 'test-only-driving-placeholder';
const origin = { lng: 113.9451, lat: 22.543 };
const body = { origin };

function providerPath(overrides: Record<string, unknown> = {}) {
  return {
    duration: '901',
    distance: '12001',
    steps: [
      { polyline: '113.950000,22.540000;113.951000,22.541000' },
      { polyline: '113.951000,22.541000;113.953000,22.541500;113.954000,22.542000' },
    ],
    ...overrides,
  };
}

function success(paths: unknown[] = [providerPath()]) {
  return { status: '1', route: { paths } };
}

beforeEach(() => {
  process.env.AMAP_WEB_SERVICE_KEY = testKey;
  // Every test starts with an offline provider; no test can fall through to a real key.
  globalThis.fetch = (async () => Response.json(success())) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.AMAP_WEB_SERVICE_KEY;
  else process.env.AMAP_WEB_SERVICE_KEY = originalKey;
});

describe('server driving routes', () => {
  test('rejects malformed origins and extra input before using a configured key', async () => {
    const request = createDrivingService();
    delete process.env.AMAP_WEB_SERVICE_KEY;
    for (const invalid of [
      null,
      [],
      '113.95,22.54',
      {},
      { origin: [] },
      { origin: { lng: '113.95', lat: 22.54 } },
      { origin: { lng: Number.NaN, lat: 22.54 } },
      { origin: { lng: 114, lat: Infinity } },
      { origin: { lng: 116.4, lat: 39.9 } },
      { origin: { lng: 114, lat: 22.54, key: testKey } },
      { origin, destination: 'https://example.com' },
    ]) {
      expect((await request(invalid)).body).toMatchObject({ error: { code: 'INVALID_ORIGIN' } });
    }
    expect(await request(body)).toMatchObject({
      status: 503,
      body: { error: { code: 'DRIVING_NOT_CONFIGURED' } },
    });
  });

  test('uses fixed destinations, converts both ends and returns full road polylines with seconds/meters converted', async () => {
    const requested: URL[] = [];
    globalThis.fetch = (async (url, init) => {
      requested.push(new URL(String(url)));
      expect(init?.redirect).toBe('error');
      return Response.json(success());
    }) as typeof fetch;
    const result = await createDrivingService()(body);
    expect(result.status).toBe(200);
    if (!('routes' in result.body)) throw new Error('Expected routes');
    expect(result.body.routes.map((route) => route.districtId)).toEqual(
      districts.map((district) => district.id),
    );
    expect(requested).toHaveLength(districts.length);
    const route = result.body.routes[0]!;
    expect(route.minutes).toBeCloseTo(901 / 60, 8);
    expect(route.distanceKm).toBe(12.001);
    expect(route.coordinates).toHaveLength(4);
    expect(route.coordinates[0]!.lng).toBeCloseTo(113.9451, 3);
    expect(route.coordinates[0]!.lat).toBeCloseTo(22.543, 3);
    const encodedOrigin = wgs84ToGcj02(origin);
    const encodedDestination = wgs84ToGcj02(districts[0]!.location);
    expect(requested[0]!.searchParams.get('origin')).toBe(
      `${encodedOrigin.lng.toFixed(6)},${encodedOrigin.lat.toFixed(6)}`,
    );
    expect(requested[0]!.searchParams.get('destination')).toBe(
      `${encodedDestination.lng.toFixed(6)},${encodedDestination.lat.toFixed(6)}`,
    );
    expect(
      requested.every(
        (url) =>
          url.origin === 'https://restapi.amap.com' && url.pathname === '/v3/direction/driving',
      ),
    ).toBe(true);
    expect(requested[0]!.searchParams.get('strategy')).toBe('10');
    expect(requested[0]!.searchParams.get('key')).toBe(testKey);
    expect(JSON.stringify(result)).not.toContain(testKey);
  });

  test('GCJ-02 conversion round trips Shenzhen locations without accumulating an offset', () => {
    for (const location of [origin, ...districts.map((district) => district.location)]) {
      const restored = gcj02ToWgs84(wgs84ToGcj02(location));
      expect(restored.lng).toBeCloseTo(location.lng, 7);
      expect(restored.lat).toBeCloseTo(location.lat, 7);
    }
  });

  test('preserves partial results and chooses the first complete valid path', async () => {
    let count = 0;
    globalThis.fetch = (async () =>
      Response.json(
        ++count === 1
          ? success([providerPath({ duration: [] }), providerPath()])
          : success([providerPath({ steps: [{ polyline: 'bad' }] })]),
      )) as unknown as typeof fetch;
    const result = await createDrivingService()(body);
    expect(result).toMatchObject({
      status: 200,
      body: { routes: [{ districtId: districts[0]!.id }] },
    });
    if (!('routes' in result.body)) throw new Error('Expected routes');
    expect(result.body.routes).toHaveLength(1);
  });

  test('rejects empty, negative, implausible or incomplete provider paths without inventing road segments', async () => {
    for (const invalid of [
      { duration: '' },
      { duration: '-1' },
      { duration: 'NaN' },
      { duration: null },
      { distance: '999999999' },
      { distance: {} },
      { steps: [] },
      { steps: [{ polyline: '113.95,22.54' }] },
      { steps: [{ polyline: '113.95,22.54;116.4,39.9' }] },
      { steps: [{ polyline: '113.95,22.54;113.96,22.55' }, {}] },
    ]) {
      globalThis.fetch = (async () =>
        Response.json(success([providerPath(invalid)]))) as unknown as typeof fetch;
      expect(await createDrivingService()(body)).toMatchObject({
        status: 502,
        body: { error: { code: 'DRIVING_UNAVAILABLE' } },
      });
    }
  });

  test('returns clean quota/configuration/network errors and stops a globally rejected batch early', async () => {
    for (const [infocode, status, code] of [
      ['10003', 429, 'DRIVING_RATE_LIMITED'],
      ['10001', 503, 'DRIVING_CONFIGURATION_ERROR'],
      ['unexpected', 502, 'DRIVING_UNAVAILABLE'],
    ] as const) {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return Response.json({ status: '0', infocode, info: testKey });
      }) as unknown as typeof fetch;
      const result = await createDrivingService()(body);
      expect(result).toMatchObject({ status, body: { error: { code } } });
      expect(JSON.stringify(result)).not.toContain(testKey);
      if (status !== 502) expect(calls).toBeLessThanOrEqual(3);
    }
    globalThis.fetch = (async () => {
      throw new Error(`https://restapi.amap.com/?key=${testKey}`);
    }) as unknown as typeof fetch;
    expect(JSON.stringify(await createDrivingService()(body))).not.toContain(testKey);
    globalThis.fetch = (async () =>
      new Response('provider html', { status: 502 })) as unknown as typeof fetch;
    expect((await createDrivingService()(body)).status).toBe(502);
    globalThis.fetch = (async () => new Response('not JSON')) as unknown as typeof fetch;
    expect((await createDrivingService()(body)).status).toBe(502);
    globalThis.fetch = (async () =>
      new Response('quota', { status: 429 })) as unknown as typeof fetch;
    expect((await createDrivingService()(body)).status).toBe(429);
  });

  test('shares a three-request concurrency limit across multiple origins', async () => {
    let active = 0;
    let peak = 0;
    globalThis.fetch = (async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return Response.json(success());
    }) as unknown as typeof fetch;
    const request = createDrivingService();
    const results = await Promise.all([
      request(body),
      request({ origin: { lng: 114.01, lat: 22.54 } }),
    ]);
    expect(results.every((result) => result.status === 200)).toBe(true);
    expect(peak).toBe(3);
  });

  test('deduplicates pending origins and caches complete success for five minutes without sharing mutable data', async () => {
    let calls = 0;
    let now = 1000;
    const clock = spyOn(Date, 'now').mockImplementation(() => now);
    try {
      globalThis.fetch = (async () => {
        calls += 1;
        return Response.json(success());
      }) as unknown as typeof fetch;
      const request = createDrivingService();
      const [first, second] = await Promise.all([request(body), request(body)]);
      expect(calls).toBe(districts.length);
      expect(first).toEqual(second);
      if ('routes' in first.body) first.body.routes.length = 0;
      now += 299_999;
      const cached = await request(body);
      expect(cached).toEqual(second);
      expect(calls).toBe(districts.length);
      now += 1;
      await request(body);
      expect(calls).toBe(districts.length * 2);
    } finally {
      clock.mockRestore();
    }
  });

  test('shortly caches partial success, never caches complete failures and bounds cached origin count', async () => {
    let calls = 0;
    let now = 1000;
    const clock = spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const request = createDrivingService();
      globalThis.fetch = (async () =>
        Response.json(++calls === 1 ? success() : success([]))) as unknown as typeof fetch;
      await request(body);
      now += 14_999;
      await request(body);
      expect(calls).toBe(districts.length);
      now += 1;
      await request(body);
      expect(calls).toBe(districts.length * 2);
      await request(body);
      expect(calls).toBe(districts.length * 3);
      calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return Response.json(success());
      }) as unknown as typeof fetch;
      const bounded = createDrivingService();
      for (let index = 0; index < 65; index += 1)
        await bounded({ origin: { lng: 114 + index / 1000, lat: 22.54 } });
      await bounded({ origin: { lng: 114, lat: 22.54 } });
      expect(calls).toBe(66 * districts.length);
    } finally {
      clock.mockRestore();
    }
  });

  test('aborts provider requests at the batch deadline and returns a clean timeout', async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const deadlines: number[] = [];
    const stub = spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      deadlines.push(milliseconds);
      return timeout(5);
    });
    try {
      globalThis.fetch = ((_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init!.signal!;
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })) as typeof fetch;
      expect(await createDrivingService()(body)).toMatchObject({
        status: 504,
        body: { error: { code: 'DRIVING_TIMEOUT' } },
      });
      expect(deadlines).toContain(22_000);
      expect(deadlines).toContain(5_000);
    } finally {
      stub.mockRestore();
    }
  });
});

async function invoke(
  options: {
    method?: string;
    text?: string;
    body?: unknown;
    headers?: Record<string, string>;
    url?: string;
  } = {},
) {
  const req = Readable.from(
    options.text === undefined ? [] : [options.text],
  ) as unknown as IncomingMessage & { body?: unknown };
  req.method = options.method ?? 'POST';
  req.url = options.url ?? '/api/driving';
  req.headers = { 'content-type': 'application/json', ...options.headers };
  if ('body' in options) req.body = options.body;
  const headers: Record<string, string> = {};
  let responseBody = '';
  const res = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(value: string) {
      responseBody = value;
    },
  };
  await handler(req, res as unknown as ServerResponse);
  return { status: res.statusCode, headers, body: JSON.parse(responseBody) };
}

describe('driving HTTP handler', () => {
  test('enforces POST and no-store JSON responses', async () => {
    const result = await invoke({ method: 'GET' });
    expect(result.status).toBe(405);
    expect(result.headers.allow).toBe('POST');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['content-type']).toContain('application/json');
  });

  test('handles Vercel parsed bodies and Vite streamed JSON', async () => {
    expect((await invoke({ body })).status).toBe(200);
    expect(
      (await invoke({ text: JSON.stringify({ origin: { lng: 114.04, lat: 22.54 } }) })).status,
    ).toBe(200);
    expect((await invoke({ body: JSON.stringify(body) })).status).toBe(200);
  });

  test('rejects malformed, duplicate, oversized and unexpected request bodies', async () => {
    const cases: Parameters<typeof invoke>[0][] = [
      { text: 'not json' },
      { text: '' },
      { body: [] },
      { body: { ...body, key: testKey } },
      { text: '{"origin":{"lng":113.95,"lat":22.54,"lng":114}}' },
      { text: '{"origin":{"lng":113.95,"lat":22.54,"l\\u006eg":114}}' },
      { text: ' '.repeat(1025) },
      { body, headers: { 'content-type': 'text/plain' } },
      { body, headers: { 'content-length': '1025' } },
      { body, headers: { 'content-length': 'bad' } },
      { body, url: '/api/driving?origin=other&origin=repeated' },
    ];
    for (const options of cases) expect((await invoke(options)).status).toBe(400);
  });
});
