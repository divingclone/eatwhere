import { afterEach, describe, expect, test } from 'bun:test';
import { searchAddresses } from './geocode';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('address search client', () => {
  test('rejects a static fallback page and malformed API response', async () => {
    globalThis.fetch = (async () =>
      new Response('<html>app</html>', {
        headers: { 'Content-Type': 'text/html' },
      })) as unknown as typeof fetch;
    await expect(searchAddresses('科技园')).rejects.toMatchObject({ name: 'AddressSearchError' });

    globalThis.fetch = (async () => Response.json({ unexpected: [] })) as unknown as typeof fetch;
    await expect(searchAddresses('科技园')).rejects.toMatchObject({ name: 'AddressSearchError' });
  });

  test('propagates helpful structured server errors', async () => {
    globalThis.fetch = (async () =>
      Response.json(
        {
          error: { code: 'GEOCODING_NOT_CONFIGURED', message: '请先选择内置地铁站。' },
        },
        { status: 503 },
      )) as unknown as typeof fetch;
    await expect(searchAddresses('科技园')).rejects.toMatchObject({
      code: 'GEOCODING_NOT_CONFIGURED',
      message: '请先选择内置地铁站。',
    });
  });

  test('cancels an in-flight lookup without converting cancellation into a network error', async () => {
    globalThis.fetch = ((_input: RequestInfo | URL, options?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options!.signal!.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      })) as unknown as typeof fetch;
    const controller = new AbortController();
    const pending = searchAddresses('科技园', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
