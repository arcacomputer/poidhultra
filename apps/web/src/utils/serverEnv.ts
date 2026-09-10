import z from 'zod';
// Runtime configuration: no filesystem reads, build-time secrets, or provider-specific URI assumptions.
export default z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    DATABASE_URL: z.string().optional(),
    PORT: z.coerce.number().default(3000),
    ADMINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .toLowerCase()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    VERCEL_URL: z.string().default(''),
    NEXT_PUBLIC_APP_URL: z.string().default('https://poidh.arca.computer'),
    MAINNET_RPC_URL: z.string().default('https://ethereum-rpc.publicnode.com'),
    BASE_RPC_URL: z.string().default('https://mainnet.base.org'),
    ARBITRUM_RPC_URL: z.string().default('https://arb1.arbitrum.io/rpc'),
    DEGEN_RPC_URL: z.string().default('https://rpc.degen.tips'),
    NEYNAR_API_KEY: z.string().optional(),
    NEYNAR_CLIENT_ID: z.string().default(''),
  })
  .parse(process.env);
