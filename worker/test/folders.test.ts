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

async function uploadFile(
  roomId: string,
  sessionToken: string,
  name: string,
  bytes: Uint8Array,
  folderId?: string | null
) {
  const folderParam = folderId ? `&folderId=${encodeURIComponent(folderId)}` : "";
  return app.request(
    `/api/rooms/${roomId}/files?name=${encodeURIComponent(name)}&type=image/jpeg${folderParam}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${sessionToken}`, "Content-Length": String(bytes.byteLength) },
      body: bytes,
    },
    env
  );
}

describe("folder creation", () => {
  it("creates a folder in a room", async () => {
    const { room, sessionToken } = await createRoom();
    const res = await app.request(
      `/api/rooms/${room.id}/folders`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ folderName: "Vacation Photos" }),
      },
      env
    );
    expect(res.status).toBe(201);
    const folder = await res.json<any>();
    expect(folder.folderName).toBe("Vacation Photos");
    expect(folder.parentFolderId).toBeNull();
  });

  it("rejects folder creation without a session", async () => {
    const { room } = await createRoom();
    const res = await app.request(
      `/api/rooms/${room.id}/folders`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderName: "Nope" }) },
      env
    );
    expect(res.status).toBe(401);
  });

  it("rejects an empty folder name", async () => {
    const { room, sessionToken } = await createRoom();
    const res = await app.request(
      `/api/rooms/${room.id}/folders`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ folderName: "  " }),
      },
      env
    );
    expect(res.status).toBe(400);
  });

  it("nests a folder inside a parent folder", async () => {
    const { room, sessionToken } = await createRoom();
    const parentRes = await app.request(
      `/api/rooms/${room.id}/folders`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ folderName: "Parent" }),
      },
      env
    );
    const parent = await parentRes.json<any>();

    const childRes = await app.request(
      `/api/rooms/${room.id}/folders`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ folderName: "Child", parentFolderId: parent.id }),
      },
      env
    );
    expect(childRes.status).toBe(201);
    const child = await childRes.json<any>();
    expect(child.parentFolderId).toBe(parent.id);
  });

  it("uploads a file into a folder and reflects it in room state", async () => {
    const { room, sessionToken } = await createRoom();
    const folderRes = await app.request(
      `/api/rooms/${room.id}/folders`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ folderName: "Photos" }),
      },
      env
    );
    const folder = await folderRes.json<any>();

    const bytes = new TextEncoder().encode("bytes-in-folder");
    const uploadRes = await uploadFile(room.id, sessionToken, "IN_FOLDER.JPG", bytes, folder.id);
    expect(uploadRes.status).toBe(201);
    const uploaded = await uploadRes.json<any>();
    expect(uploaded.folderId).toBe(folder.id);

    const stateRes = await app.request(`/api/rooms/${room.id}`, { headers: { Authorization: `Bearer ${sessionToken}` } }, env);
    const state = await stateRes.json<any>();
    expect(state.folders).toHaveLength(1);
    expect(state.files.find((f: any) => f.id === uploaded.id).folderId).toBe(folder.id);
  });
});

describe("multi-select download", () => {
  it("downloads a zip containing only the selected files", async () => {
    const { room, sessionToken } = await createRoom();
    const a = await (await uploadFile(room.id, sessionToken, "A.JPG", new TextEncoder().encode("aaa"))).json<any>();
    const b = await (await uploadFile(room.id, sessionToken, "B.JPG", new TextEncoder().encode("bbb"))).json<any>();
    await uploadFile(room.id, sessionToken, "C.JPG", new TextEncoder().encode("ccc"));

    const res = await app.request(
      `/api/rooms/${room.id}/download-selected?fileIds=${a.id},${b.id}`,
      { headers: { Authorization: `Bearer ${sessionToken}` } },
      env
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("zip");
    const zipBytes = await res.arrayBuffer();
    expect(zipBytes.byteLength).toBeGreaterThan(0);
  });

  it("rejects download-selected with no file ids", async () => {
    const { room, sessionToken } = await createRoom();
    const res = await app.request(
      `/api/rooms/${room.id}/download-selected`,
      { headers: { Authorization: `Bearer ${sessionToken}` } },
      env
    );
    expect(res.status).toBe(400);
  });

  it("rejects download-selected without a session", async () => {
    const { room } = await createRoom();
    const res = await app.request(`/api/rooms/${room.id}/download-selected?fileIds=x,y`, {}, env);
    expect(res.status).toBe(401);
  });
});
