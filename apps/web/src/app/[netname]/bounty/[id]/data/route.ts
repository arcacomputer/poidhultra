import { communityProxy } from '@/utils/communityProxy';
import { resolveLegacyURL, key } from '@poidh/protocol';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ netname: string; id: string }> }
) {
  const { netname, id } = await params;
  try {
    const r = resolveLegacyURL(netname, id);
    return communityProxy(
      request,
      '/api/v1/bounties/' +
        key(r.deployment.chainId, r.deployment.address, r.onChainId)
    );
  } catch {
    return Response.json({ error: 'Unknown bounty' }, { status: 404 });
  }
}
