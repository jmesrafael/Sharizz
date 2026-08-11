// Room session tokens: HMAC-signed, stateless, short-lived (matches room
// expiry). Format: base64url(payload) + "." + base64url(signature).
// The frontend stores this in sessionStorage (never localStorage, never
// the PIN itself) and sends it as `Authorization: Bearer <token>`.

interface SessionPayload {
  roomId: string;
  exp: number;
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createSessionToken(
  secret: string,
  roomId: string,
  expiresAtMs: number
): Promise<string> {
  const payload: SessionPayload = { roomId, exp: expiresAtMs };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const key = await getKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, payloadBytes);
  return `${toBase64Url(payloadBytes.buffer as ArrayBuffer)}.${toBase64Url(signature)}`;
}

export async function verifySessionToken(
  secret: string,
  token: string,
  expectedRoomId: string
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadPart, sigPart] = parts;

  let payloadBytes: Uint8Array;
  let signature: Uint8Array;
  try {
    payloadBytes = fromBase64Url(payloadPart);
    signature = fromBase64Url(sigPart);
  } catch {
    return false;
  }

  const key = await getKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    payloadBytes as unknown as ArrayBuffer
  );
  if (!valid) return false;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return false;
  }

  if (payload.roomId !== expectedRoomId) return false;
  if (Date.now() >= payload.exp) return false;
  return true;
}
