import { baseProcedure } from '../init';
import { z } from 'zod';
import prisma from 'prisma/prisma';
// Compatibility name retained for upstream clients. Reads never require a social API.
export const neynarRouter = {
  usersData: baseProcedure
    .input(z.object({ addresses: z.array(z.string()).max(100) }))
    .query(({ input }) => getUsersDataOrFetchItFromNeynar(input.addresses)),
};
export async function getUsersDataOrFetchItFromNeynar(addresses: string[]) {
  return prisma.usersExtra.findMany({
    where: { address: { in: addresses.map((a) => a.toLowerCase()) } },
  });
}
