export const readOnlyPreview =
  process.env.NEXT_PUBLIC_READ_ONLY_PREVIEW === 'true';

export function requireWritableClient() {
  if (readOnlyPreview)
    throw new Error(
      'This preview is read-only while indexing and shared community launch checks are completed.'
    );
}
