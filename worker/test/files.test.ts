import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { currentTimeCode } from "../src/lib/timeGate";

async function createRoom() {
  const created = await app.request(
    "/api/rooms",
    { method: "POST", body: JSON.stringify({ code: currentTimeCode() }), headers: { "Content-Type": "application/json" } },
    env
  );
  return created.json<any>();
}

async function uploadFile(roomId: string, sessionToken: string, name: string, bytes: Uint8Array, type = "image/jpeg") {
  return app.request(
    `/api/rooms/${roomId}/files?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": "application/octet-stream",
      },
      body: bytes,
    },
    env
  );
}

describe("file upload authorization", () => {
  it("accepts an upload with a valid session token", async () => {
    const { room, sessionToken } = await createRoom();
    const bytes = new TextEncoder().encode("fake-jpeg-bytes");

    const res = await uploadFile(room.id, sessionToken, "IMG_001.JPG", bytes);
    expect(res.status).toBe(201);
    const body = await res.json<any>();
    expect(body.originalName).toBe("IMG_001.JPG");
    expect(body.fileSize).toBe(bytes.byteLength);
  });

  it("rejects an upload without a session token", async () => {
    const { room } = await createRoom();
    const bytes = new TextEncoder().encode("fake-jpeg-bytes");

    const res = await app.request(
      `/api/rooms/${room.id}/files?name=IMG_002.JPG&type=image/jpeg`,
      { method: "PUT", headers: { "Content-Length": String(bytes.byteLength) }, body: bytes },
      env
    );
    expect(res.status).toBe(401);
  });

  // Sharizz stores any file type — arbitrary/unrecognized mime types are
  // stored as declared rather than rejected (they just render as a
  // download-only placeholder in the grid instead of an inline preview).
  it("accepts an arbitrary, non-media file type", async () => {
    const { room, sessionToken } = await createRoom();
    const bytes = new TextEncoder().encode("not-an-image-or-video");

    const res = await uploadFile(room.id, sessionToken, "notes.pdf", bytes, "application/pdf");
    expect(res.status).toBe(201);
    const body = await res.json<any>();
    expect(body.mimeType).toBe("application/pdf");
  });

  it("saves file metadata in D1", async () => {
    const { room, sessionToken } = await createRoom();
    const bytes = new TextEncoder().encode("fake-heic-bytes");

    await uploadFile(room.id, sessionToken, "IMG_004.HEIC", bytes, "image/heic");

    const row = await env.DB.prepare("SELECT * FROM files WHERE room_id = ?").bind(room.id).first<any>();
    expect(row.original_name).toBe("IMG_004.HEIC");
    expect(row.mime_type).toBe("image/heic");
    expect(row.file_size).toBe(bytes.byteLength);
  });
});

describe("file download authorization", () => {
  it("downloads the original file with a valid session", async () => {
    const { room, sessionToken } = await createRoom();
    const bytes = new TextEncoder().encode("original-quality-bytes");
    const uploadRes = await uploadFile(room.id, sessionToken, "IMG_005.PNG", bytes, "image/png");
    const { id: fileId } = await uploadRes.json<any>();

    const res = await app.request(
      `/api/rooms/${room.id}/files/${fileId}`,
      { headers: { Authorization: `Bearer ${sessionToken}` } },
      env
    );
    expect(res.status).toBe(200);
    const downloaded = new Uint8Array(await res.arrayBuffer());
    expect(downloaded).toEqual(bytes);
    expect(res.headers.get("Content-Disposition")).toContain("IMG_005.PNG");
  });

  it("rejects a download without a session token", async () => {
    const { room, sessionToken } = await createRoom();
    const bytes = new TextEncoder().encode("original-quality-bytes");
    const uploadRes = await uploadFile(room.id, sessionToken, "IMG_006.PNG", bytes, "image/png");
    const { id: fileId } = await uploadRes.json<any>();

    const res = await app.request(`/api/rooms/${room.id}/files/${fileId}`, {}, env);
    expect(res.status).toBe(401);
  });

  it("returns not found for a file id that does not belong to the room", async () => {
    const { room, sessionToken } = await createRoom();
    const res = await app.request(
      `/api/rooms/${room.id}/files/nonexistent-file`,
      { headers: { Authorization: `Bearer ${sessionToken}` } },
      env
    );
    expect(res.status).toBe(404);
  });
});
