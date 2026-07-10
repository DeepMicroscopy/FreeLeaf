import { createHmac, timingSafeEqual } from "node:crypto";

// Mirrors apps/api/core/collab_tokens.py exactly — same shared secret, same
// "<base64url(json)>.<hex hmac-sha256>" format. See that module's docstring
// for why this isn't JWT.

export interface CollabTokenPayload {
  project_id: string;
  file_id: string;
  user_id: string;
  display_name: string;
  role: "owner" | "editor" | "viewer";
  exp: number;
}

export class InvalidCollabToken extends Error {}

function base64UrlDecode(input: string): Buffer {
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function verifyCollabToken(token: string, secret: string): CollabTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 2) throw new InvalidCollabToken("malformed token");
  const [payloadB64, signature] = parts;

  const expected = createHmac("sha256", secret).update(payloadB64).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length || !timingSafeEqual(expectedBuf, signatureBuf)) {
    throw new InvalidCollabToken("bad signature");
  }

  let payload: CollabTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    throw new InvalidCollabToken("malformed payload");
  }

  if (!payload.exp || payload.exp < Date.now() / 1000) {
    throw new InvalidCollabToken("expired");
  }
  return payload;
}
