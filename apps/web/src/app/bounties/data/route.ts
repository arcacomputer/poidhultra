import { communityProxy } from '@/utils/communityProxy';
export function GET(request: Request) {
  return communityProxy(request, '/api/v1/bounties');
}
