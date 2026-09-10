import { communityProxy } from '@/utils/communityProxy';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  if (
    path.length !== 2 ||
    path[0] !== 'sha256' ||
    !/^[a-f0-9]{64}$/.test(path[1])
  )
    return new Response('Not found', { status: 404 });
  return communityProxy(request, '/media/' + path.join('/'));
}
