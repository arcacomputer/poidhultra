import { communityProxy } from '@/utils/communityProxy';
import { mediaCache } from '@/utils/mediaCache';
import { resolveRecordImage } from '@poidh/storage/media-handler';

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ kind: string; id: string }>;
  }
) {
  const { kind, id } = await params;
  try {
    const { mirror } = await mediaCache();
    return await resolveRecordImage(
      kind,
      id,
      (path) => {
        // Resolve public records with a fresh request, never a visitor's session.
        const read = new Request(new URL(path, request.url));
        return communityProxy(read, new URL(read.url).pathname);
      },
      mirror
    );
  } catch {
    return Response.json(
      { error: 'Image storage unavailable' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' },
      }
    );
  }
}
