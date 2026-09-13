import { afterEach, describe, expect, test } from 'bun:test';
import { districts } from './data';
import { fetchDrivingRoutes, loadDrivingRoutes } from './driving';
import { drivingOriginKey } from './routing';
import type { Coordinate } from './types';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const origin = (lng: number): Coordinate => ({ lng, lat: 22.6 });
const payload = (start: Coordinate, count = districts.length) => ({
  routes: districts.slice(0, count).map((district) => ({
    districtId: district.id,
    minutes: 20,
    distanceKm: 12,
    coordinates: [start, district.location],
  })),
});

describe('driving route client', () => {
  test('posts only the origin and reuses complete estimates for the same origin', async () => {
    let requests = 0;
    const start = origin(114.01);
    globalThis.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
      requests++;
      expect(input).toBe('/api/driving');
      expect(options?.method).toBe('POST');
      expect(JSON.parse(String(options?.body))).toEqual({ origin: start });
      return Response.json(payload(start));
    }) as unknown as typeof fetch;
    const signal = new AbortController().signal;
    expect(await fetchDrivingRoutes(start, signal)).toHaveLength(districts.length);
    expect(await fetchDrivingRoutes({ ...start }, signal)).toHaveLength(districts.length);
    expect(requests).toBe(1);
    await fetchDrivingRoutes(start, signal, true);
    expect(requests).toBe(2);
  });

  test('deduplicates origins, limits batches to two, and keeps results tied to coordinates', async () => {
    let active = 0;
    let peak = 0;
    let requests = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
      const start = JSON.parse(String(options?.body)).origin;
      requests++;
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return Response.json(payload(start));
    }) as unknown as typeof fetch;
    const starts = [origin(114.02), origin(114.03), origin(114.04)];
    const result = await loadDrivingRoutes([...starts, starts[0]!], new AbortController().signal);
    expect(requests).toBe(3);
    expect(peak).toBe(2);
    expect(Object.keys(result.routes)).toEqual(
      expect.arrayContaining(starts.map(drivingOriginKey)),
    );
    expect(result.errors).toEqual([]);
    for (const start of starts)
      expect(result.routes[drivingOriginKey(start)]![0]!.coordinates[0]).toEqual(start);
  });

  test('keeps partial results while rejecting malformed and unknown districts', async () => {
    const start = origin(114.05);
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      return Response.json({
        routes: [
          ...payload(start, 1).routes,
          { ...payload(start, 1).routes[0], districtId: districts[1]!.id, minutes: -1 },
          { ...payload(start, 1).routes[0], districtId: 'unknown' },
        ],
      });
    }) as unknown as typeof fetch;
    const signal = new AbortController().signal;
    const result = await loadDrivingRoutes([start], signal);
    expect(result.routes[drivingOriginKey(start)]).toHaveLength(1);
    expect(result.errors[0]).toContain('粗略估算');
    await loadDrivingRoutes([start], signal);
    expect(requests).toBe(2);
  });

  test('provider configuration failure stops remaining queued origins', async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      return Response.json(
        { error: { code: 'DRIVING_NOT_CONFIGURED', message: '暂未开通驾车估时。' } },
        { status: 503 },
      );
    }) as unknown as typeof fetch;
    const result = await loadDrivingRoutes(
      [origin(114.06), origin(114.07), origin(114.08), origin(114.09)],
      new AbortController().signal,
    );
    expect(requests).toBe(2);
    expect(result.routes).toEqual({});
    expect(result.errors).toEqual(['暂未开通驾车估时。']);
  });

  test('an obsolete batch cannot deliver a response after cancellation', async () => {
    const controller = new AbortController();
    let release!: (response: Response) => void;
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => (release = resolve))) as unknown as typeof fetch;
    const start = origin(114.1);
    const request = loadDrivingRoutes([start], controller.signal);
    controller.abort();
    release(Response.json(payload(start)));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('a static preview HTML response gives a readable fallback error', async () => {
    globalThis.fetch = (async () =>
      new Response('<html>Preview</html>')) as unknown as typeof fetch;
    await expect(fetchDrivingRoutes(origin(114.11), new AbortController().signal)).rejects.toThrow(
      '粗略估算',
    );
  });
});
