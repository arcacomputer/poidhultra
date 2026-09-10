import { Profile } from '@/components/ultra/community-pages';
import { notFound } from 'next/navigation';
export default async function Page({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) notFound();
  return <Profile address={address.toLowerCase()} />;
}
