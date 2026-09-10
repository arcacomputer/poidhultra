import {
  createSiweMessage,
  parseSiweMessage,
  validateSiweMessage,
} from "viem/siwe";
import { getAddress, verifyMessage, type Hex } from "viem";
export const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
export async function digest(value: string | Uint8Array) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource)
    ),
    (b) => b.toString(16).padStart(2, "0")
  ).join("");
}
export function challenge({
  origin,
  address,
  chainId,
  now = new Date(),
  nonce = randomToken(),
}: {
  origin: string;
  address: string;
  chainId: number;
  now?: Date;
  nonce?: string;
}) {
  const url = new URL(origin);
  if (url.origin !== origin) throw new Error("Origin must be canonical");
  if (![1, 8453, 42161].includes(chainId))
    throw new Error("Unsupported login chain");
  return {
    nonce,
    message: createSiweMessage({
      address: getAddress(address),
      chainId,
      domain: url.host,
      uri: origin,
      version: "1",
      nonce,
      statement: "Sign in to poidh. This does not authorize a transaction.",
      issuedAt: now,
      expirationTime: new Date(now.getTime() + 5 * 60_000),
    }),
  };
}
export async function verifyChallenge({
  message,
  signature,
  expectedMessage,
  origin,
  now = new Date(),
}: {
  message: string;
  signature: Hex;
  expectedMessage: string;
  origin: string;
  now?: Date;
}) {
  if (message !== expectedMessage) throw new Error("Challenge does not match");
  const fields = parseSiweMessage(message);
  if (
    fields.uri !== origin ||
    !fields.address ||
    !fields.nonce ||
    !fields.expirationTime ||
    !fields.issuedAt ||
    fields.issuedAt.getTime() > now.getTime() + 30_000 ||
    !validateSiweMessage({
      message: fields,
      domain: new URL(origin).host,
      nonce: fields.nonce,
      time: now,
    })
  )
    throw new Error("Invalid or expired SIWE message");
  if (!(await verifyMessage({ address: fields.address, message, signature })))
    throw new Error("Invalid signature");
  return { address: fields.address.toLowerCase(), nonce: fields.nonce };
}
export function requireSameOrigin(request: Request, origin: string) {
  if (request.headers.get("origin") !== origin)
    throw new Error("Origin mismatch");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new Error("Cross-site request");
}
