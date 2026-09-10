/** Resolve displayable media only; never turn arbitrary claim text into a URL. */
export function mediaURL(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  let source = value.trim();
  if (source.startsWith("ipfs://")) {
    const path = source.slice(7).replace(/^ipfs\//, "");
    if (!path || path.startsWith("/") || path.includes("..")) return null;
    source =
      (process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? "https://ipfs.io/ipfs/") + path;
  }
  try {
    const url = new URL(source);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** A bounded scan of inline Markdown images, including angle-wrapped URLs and
 * optional titles. No HTML from a bounty description is inserted into a card. */
export function cardMedia(description: string, explicitImage?: string | null) {
  const pattern = /!\[[^\]\n]{0,500}\]\(([^\n]{1,5000}?)\)/g;
  let image = mediaURL(explicitImage);
  const excerpt: string[] = [];
  let end = 0;
  for (const match of description.slice(0, 20_000).matchAll(pattern)) {
    const target = match[1].trim();
    const url = target.startsWith("<")
      ? target.slice(1, target.indexOf(">"))
      : target.split(/\s/, 1)[0];
    image ??= mediaURL(url);
    excerpt.push(description.slice(end, match.index));
    end = match.index! + match[0].length;
  }
  excerpt.push(description.slice(end));
  return { image, description: excerpt.join("").trim() };
}
