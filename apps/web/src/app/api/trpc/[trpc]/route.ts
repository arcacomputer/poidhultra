import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { compatibilityRouter } from '@/trpc/compatibility';
const handler = (request: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req: request,
    router: compatibilityRouter,
    createContext: () => ({ request }),
  });
export { handler as GET, handler as POST };
