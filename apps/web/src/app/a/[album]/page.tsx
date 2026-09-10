import { Album } from '@/components/ultra/community-pages';
export default async function Page({
  params,
}: {
  params: Promise<{ album: string }>;
}) {
  const { album } = await params;
  return <Album id={album} />;
}
