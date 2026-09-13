export interface AddressResult {
  id: string;
  name: string;
  address: string;
  location: { lng: number; lat: number };
}

export class AddressSearchError extends Error {
  constructor(
    message: string,
    public readonly code = 'GEOCODING_UNAVAILABLE',
  ) {
    super(message);
    this.name = 'AddressSearchError';
  }
}

/** Address lookup is opt-in via the UI; no server key is included in the bundle. */
export async function searchAddresses(
  query: string,
  signal?: AbortSignal,
): Promise<AddressResult[]> {
  if (signal?.aborted) throw new DOMException('搜索已取消', 'AbortError');
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2 || normalizedQuery.length > 100) {
    throw new AddressSearchError('请输入 2–100 个字符的深圳地址或地点名称。', 'INVALID_QUERY');
  }
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 10_000);

  try {
    const response = await fetch(`/api/geocode?${new URLSearchParams({ q: normalizedQuery })}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new AddressSearchError('地址搜索接口暂不可用，可先选择内置地铁站和商圈。');
    }
    const data = await response.json();
    if (!response.ok) {
      throw new AddressSearchError(
        typeof data?.error?.message === 'string'
          ? data.error.message
          : '地址搜索失败，请稍后重试。',
        typeof data?.error?.code === 'string' ? data.error.code : undefined,
      );
    }
    if (!Array.isArray(data?.results))
      throw new AddressSearchError('地址搜索返回异常，请稍后重试。');
    return data.results
      .filter(
        (result: AddressResult) =>
          typeof result?.id === 'string' &&
          typeof result?.name === 'string' &&
          typeof result?.address === 'string' &&
          Number.isFinite(result?.location?.lng) &&
          Number.isFinite(result?.location?.lat),
      )
      .slice(0, 6);
  } catch (cause) {
    if (signal?.aborted) throw new DOMException('搜索已取消', 'AbortError');
    if (timedOut)
      throw new AddressSearchError(
        '地址搜索超时，请稍后重试，或选择附近的地铁站。',
        'GEOCODING_TIMEOUT',
      );
    if (cause instanceof AddressSearchError) throw cause;
    throw new AddressSearchError('无法连接地址搜索服务，请检查网络后重试。');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
