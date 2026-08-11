function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 128 bits of entropy, URL-safe — used as the room's public identifier.
// Collision-resistant enough that room IDs double as unguessable secrets
// (the PIN is the second, human-facing factor).
export function generateRoomId(): string {
  return randomBase64Url(16);
}

export function generateFileId(): string {
  return randomBase64Url(12);
}

export function generateSessionId(): string {
  return randomBase64Url(24);
}

export function generateFolderId(): string {
  return randomBase64Url(12);
}
