const videoExtensions = new Set(['mp4', 'webm', 'ogg', 'mov']);

export function isVideoSource(source: string) {
  const path = source.split(/[?#]/, 1)[0];
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return videoExtensions.has(extension);
}
