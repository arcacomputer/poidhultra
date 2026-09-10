import { communityProxy } from '@/utils/communityProxy';
async function handler(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  if (path.some((p) => p === '.' || p === '..' || p.includes('/')))
    return new Response('Invalid path', { status: 400 });
  return communityProxy(
    request,
    '/api/v1/' + path.map(encodeURIComponent).join('/')
  );
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
