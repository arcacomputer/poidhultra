import { communityProxy } from '@/utils/communityProxy';
import { mediaCache } from '@/utils/mediaCache';
import { serveImage } from '@poidh/storage/mirror';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  if (path.length === 3 && path[0] === 'remote' && path[1] === 'sha256') {
    try {
      const { storage, edge } = await mediaCache();
      return await serveImage(request, path[2], storage, edge);
    } catch {
      return new Response('Image storage unavailable', {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }
  if (
    path.length !== 2 ||
    path[0] !== 'sha256' ||
    !/^[a-f0-9]{64}$/.test(path[1])
  )
    return new Response('Not found', { status: 404 });
  return communityProxy(request, '/media/' + path.join('/'));
}
