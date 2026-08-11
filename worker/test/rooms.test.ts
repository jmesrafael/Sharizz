import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { hashPin } from "../src/lib/pin";

async function createRoom(roomName: string, pin: string) {
  const res = await app.request(
    "/api/rooms",
    { method: "POST", body: JSON.stringify({ roomName, pin }), headers: { "Content-Type": "application/json" } },
    env
  );
  return res;
}

describe("room creation", () => {
  it("creates a room and returns a session token", async () => {
    const res = await createRoom("Outing1", "1234");
    expect(res.status).toBe(201);
    const body = await res.json<any>();
    expect(body.room.roomName).toBe("Outing1");
    expect(body.room.status).toBe("active");
    expect(typeof body.sessionToken).toBe("string");
  });

  it("rejects an invalid room name", async () => {
    const res = await createRoom("!!", "1234");
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric pin", async () => {
    const res = await createRoom("Outing2", "abcd");
    expect(res.status).toBe(400);
  });

  it("never stores the plaintext pin", async () => {
    await createRoom("Outing3", "9999");
    const row = await env.DB.prepare("SELECT pin_hash FROM rooms WHERE room_name = ?")
      .bind("Outing3")
      .first<{ pin_hash: string }>();
    expect(row?.pin_hash).not.toContain("9999");
  });
});

describe("entering a room", () => {
  it("accepts the correct pin", async () => {
    const created = await createRoom("Birthday1", "4242");
    const { room } = await created.json<any>();

    const res = await app.request(
      `/api/rooms/${room.id}/enter`,
      { method: "POST", body: JSON.stringify({ pin: "4242" }), headers: { "Content-Type": "application/json" } },
      env
    );
    expect(res.status).toBe(200);
  });

  it("rejects an incorrect pin", async () => {
    const created = await createRoom("Birthday2", "4242");
    const { room } = await created.json<any>();

    const res = await app.request(
      `/api/rooms/${room.id}/enter`,
      { method: "POST", body: JSON.stringify({ pin: "0000" }), headers: { "Content-Type": "application/json" } },
      env
    );
    expect(res.status).toBe(401);
  });

  it("rejects entry to a room that does not exist", async () => {
    const res = await app.request(
      "/api/rooms/does-not-exist/enter",
      { method: "POST", body: JSON.stringify({ pin: "1234" }), headers: { "Content-Type": "application/json" } },
      env
    );
    expect(res.status).toBe(404);
  });

  it("rejects entry to an expired room", async () => {
    const pinHash = await hashPin("1111");
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO rooms (id, room_name, pin_hash, created_at, expires_at, status, storage_bytes_used)
       VALUES (?, ?, ?, ?, ?, 'active', 0)`
    )
      .bind("expired-room", "OldTrip", pinHash, now - 1000, now - 1)
      .run();

    const res = await app.request(
      "/api/rooms/expired-room/enter",
      { method: "POST", body: JSON.stringify({ pin: "1111" }), headers: { "Content-Type": "application/json" } },
      env
    );
    expect(res.status).toBe(410);
  });

  it("locks out further attempts after MAX_PIN_ATTEMPTS", async () => {
    const created = await createRoom("LockoutRoom", "7777");
    const { room } = await created.json<any>();

    let lastStatus = 0;
    for (let i = 0; i < 10; i++) {
      const res = await app.request(
        `/api/rooms/${room.id}/enter`,
        { method: "POST", body: JSON.stringify({ pin: "0000" }), headers: { "Content-Type": "application/json" } },
        env
      );
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("room access authorization", () => {
  it("rejects room state requests without a session token", async () => {
    const created = await createRoom("NoAuthRoom", "1234");
    const { room } = await created.json<any>();

    const res = await app.request(`/api/rooms/${room.id}`, {}, env);
    expect(res.status).toBe(401);
  });

  it("returns room state with a valid session token", async () => {
    const created = await createRoom("AuthRoom", "1234");
    const { room, sessionToken } = await created.json<any>();

    const res = await app.request(
      `/api/rooms/${room.id}`,
      { headers: { Authorization: `Bearer ${sessionToken}` } },
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.files).toEqual([]);
  });
});
