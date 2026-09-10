export { mediaURL, cardMedia } from '@poidh/storage/media-source';

/** Browsers only receive an immutable URL after the server has stored the image. */
export async function cachedImage(
  kind: 'bounty' | 'claim' | 'profile',
  id: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = (...args) => globalThis.fetch(...args)
): Promise<string | null> {
  const response = await fetcher(
    '/api/media/' + kind + '/' + encodeURIComponent(id),
    {
      credentials: 'omit',
      redirect: 'error',
      signal,
    }
  );
  if (response.status === 404 || response.status === 422) return null;
  if (!response.ok) throw new Error('Image cache unavailable');
  const result = await response.json();
  if (!/^\/media\/remote\/sha256\/[a-f0-9]{64}$/.test(result.url))
    throw new Error('Invalid cached image URL');
  return result.url;
}
