import { BountyDetail } from '@/components/ultra/bounty-detail';
export default async function Bounty({
  params,
}: {
  params: Promise<{ netname: string; id: string }>;
}) {
  const { netname, id } = await params;
  return <BountyDetail slug={netname} display={id} />;
}
