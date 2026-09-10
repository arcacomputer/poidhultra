import type { Metadata } from 'next';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ netname: string; id: string }>;
}): Promise<Metadata> {
  const { netname, id } = await params;
  return {
    title: `Bounty #${id} on ${netname}`,
    alternates: { canonical: `/${netname}/bounty/${id}` },
  };
}
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
