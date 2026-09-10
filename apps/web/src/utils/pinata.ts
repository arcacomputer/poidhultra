// Compatibility module: new uploads are stored by the open-source community service.
import { CommunityClient } from '@poidh/client';
const api = new CommunityClient();
export async function compressImage(file: Blob) {
  return file;
}
export async function uploadFile(file: string | Blob) {
  if (typeof file === 'string') throw new Error('Choose a local proof file');
  const response = await api.upload(
    new File([file], 'proof', { type: file.type })
  );
  return response;
}
export async function uploadMetadata(
  metadata: ReturnType<typeof buildMetadata>
) {
  return api.metadata(metadata);
}
export function buildMetadata(
  image: string,
  name: string,
  description: string
) {
  return {
    name,
    description,
    image,
    external_url:
      process.env.NEXT_PUBLIC_APP_URL ?? 'https://poidh.arca.computer',
    attributes: [],
  };
}
export default buildMetadata;
