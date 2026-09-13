import { afterEach, describe, expect, test } from 'bun:test';
import { geocodeRequest } from '../../api/geocode';

const originalFetch = globalThis.fetch;
const originalKey = process.env.AMAP_WEB_SERVICE_KEY;
const testKey = 'test-only-placeholder';

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.AMAP_WEB_SERVICE_KEY;
  else process.env.AMAP_WEB_SERVICE_KEY = originalKey;
});

function mockProvider(body: unknown) {
  process.env.AMAP_WEB_SERVICE_KEY = testKey;
  globalThis.fetch = (async () => Response.json(body)) as unknown as typeof fetch;
}

describe('server address search', () => {
  test('validates the query before requiring a configured key', async () => {
    delete process.env.AMAP_WEB_SERVICE_KEY;
    expect((await geocodeRequest('a')).status).toBe(400);
    expect((await geocodeRequest('科技\n园')).status).toBe(400);
    expect((await geocodeRequest('科技园')).body).toMatchObject({
      error: { code: 'GEOCODING_NOT_CONFIGURED' },
    });
  });

  test('isolates query input, filters Shenzhen results and converts GCJ-02 to WGS84', async () => {
    process.env.AMAP_WEB_SERVICE_KEY = testKey;
    let requestedUrl: URL | undefined;
    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrl = new URL(String(url));
      return Response.json({
        status: '1',
        pois: [
          {
            id: 'sz',
            name: '科技园',
            cityname: '深圳市',
            adname: '南山区',
            address: '深南大道',
            adcode: '440305',
            location: '113.95,22.54',
          },
          { id: 'outside', name: '广州市地点', adcode: '440106', location: '113.95,22.54' },
          { id: 'invalid', name: '无效地点', adcode: '440305', location: 'nope,22.54' },
          { id: 'sz', name: '科技园', adcode: '440305', location: '113.95,22.54' },
        ],
      });
    }) as unknown as typeof fetch;

    const result = await geocodeRequest('科技园&key=other');
    expect(result.status).toBe(200);
    if (!('results' in result.body)) throw new Error('Expected a successful search');
    expect(result.body.results).toHaveLength(1);
    expect(result.body.results[0]!.location.lng).toBeCloseTo(113.9451, 3);
    expect(result.body.results[0]!.location.lat).toBeCloseTo(22.543, 3);
    expect(requestedUrl!.hostname).toBe('restapi.amap.com');
    expect(requestedUrl!.searchParams.get('keywords')).toBe('科技园&key=other');
    expect(requestedUrl!.searchParams.get('key')).toBe(testKey);
    expect(requestedUrl!.searchParams.get('citylimit')).toBe('true');
    expect(JSON.stringify(result.body)).not.toContain(testKey);
  });

  test('falls back to detailed geocoding without accepting a city centroid', async () => {
    process.env.AMAP_WEB_SERVICE_KEY = testKey;
    let calls = 0;
    globalThis.fetch = (async () =>
      Response.json(
        ++calls === 1
          ? { status: '1', pois: [] }
          : {
              status: '1',
              geocodes: [
                {
                  adcode: '440300',
                  location: '114.05,22.54',
                  level: '市',
                  formatted_address: '深圳市',
                },
                {
                  adcode: '440305',
                  location: '113.95,22.54',
                  level: '门牌号',
                  formatted_address: '深圳市南山区深南大道1号',
                },
              ],
            },
      )) as unknown as typeof fetch;
    const result = await geocodeRequest('深南大道1号');
    expect(calls).toBe(2);
    if (!('results' in result.body)) throw new Error('Expected a successful search');
    expect(result.body.results).toHaveLength(1);
    expect(result.body.results[0]!.address).toBe('深圳市南山区深南大道1号');
  });

  test('returns safe quota and configuration errors without exposing upstream content', async () => {
    mockProvider({ status: '0', infocode: '10003', info: testKey });
    const quota = await geocodeRequest('科技园');
    expect(quota.status).toBe(429);
    expect(quota.body).toMatchObject({ error: { code: 'GEOCODING_RATE_LIMITED' } });
    expect(JSON.stringify(quota)).not.toContain(testKey);

    mockProvider({ status: '0', infocode: '10001', info: testKey });
    const invalidKey = await geocodeRequest('科技园');
    expect(invalidKey.status).toBe(503);
    expect(invalidKey.body).toMatchObject({ error: { code: 'GEOCODING_CONFIGURATION_ERROR' } });
    expect(JSON.stringify(invalidKey)).not.toContain(testKey);
  });
});
