import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { hashPin } from "../src/lib/pin";
import { currentTimeCode } from "../src/lib/timeGate";

async function createRoom(code: string, ip = "203.0.113.1") {
  const res = await app.request(
    "/api/rooms",
    {
      method: "POST",
      body: JSON.stringify({ code }),
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    },
    env
  );
  return res;
}

describe("room creation via time-gate", () => {
  it("creates a room when the code matches the current time", async () => {
    const res = await createRoom(currentTimeCode());
    expect(res.status).toBe(201);
    const body = await res.json<any>();
    expect(body.room.status).toBe("active");
    expect(typeof body.room.roomName).toBe("string");
    expect(typeof body.sessionToken).toBe("string");
  });

  it("rejects a non-numeric code", async () => {
    const res = await createRoom("abcd", "203.0.113.2");
    expect(res.status).toBe(401);
  });

  it("rejects a code that doesn't match the current time", async () => {
    // "0000" only matches real time at midnight ± tolerance; safe as a
    // near-guaranteed mismatch for a test run at any other time of day.
    const wrong = currentTimeCode() === "0000" ? "0101" : "0000";
    const res = await createRoom(wrong, "203.0.113.3");
    expect(res.status).toBe(401);
  });

  it("never stores the plaintext code", async () => {
    const code = currentTimeCode();
    const created = await createRoom(code, "203.0.113.4");
    const { room } = await created.json<any>();
    const row = await env.DB.prepare("SELECT pin_hash FROM rooms WHERE id = ?")
      .bind(room.id)
      .first<{ pin_hash: string }>();
    expect(row?.pin_hash).not.toContain(code);
  });

  it("locks out further attempts after MAX_GATE_ATTEMPTS wrong codes", async () => {
    const wrong = currentTimeCode() === "0000" ? "0101" : "0000";
    let lastStatus = 0;
    for (let i = 0; i < 10; i++) {
      const res = await createRoom(wrong, "203.0.113.5");
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("joining an existing room via its code", () => {
  it("returns the same room and a fresh session token when the code matches a live room's room_code", async () => {
    const created = await createRoom(currentTimeCode(), "203.0.113.20");
    const { room, sessionToken: firstToken } = await created.json<any>();
    expect(typeof room.roomCode).toBe("string");

    const joined = await createRoom(room.roomCode, "203.0.113.21");
    expect(joined.status).toBe(200);
    const { room: joinedRoom, sessionToken: secondToken } = await joined.json<any>();
    expect(joinedRoom.id).toBe(room.id);
    expect(secondToken).not.toBe(firstToken);
  });

  it("rejects a room_code that belonged to a since-deleted room", async () => {
    const created = await createRoom(currentTimeCode(), "203.0.113.22");
    const { room, sessionToken } = await created.json<any>();

    await app.request(
      `/api/rooms/${room.id}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${sessionToken}` } },
      env
    );

    const res = await createRoom(room.roomCode, "203.0.113.23");
    expect(res.status).toBe(401);
  });
});

describe("room access authorization", () => {
  it("rejects room state requests without a session token", async () => {
    const created = await createRoom(currentTimeCode(), "203.0.113.6");
    const { room } = await created.json<any>();

    const res = await app.request(`/api/rooms/${room.id}`, {}, env);
    expect(res.status).toBe(401);
  });

  it("returns room state with a valid session token", async () => {
    const created = await createRoom(currentTimeCode(), "203.0.113.7");
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

  // Guest links carry the session token as a query param (EventSource-style
  // fallback) so a recipient never needs to solve the gate themselves.
  it("returns room state with a session token passed via query string", async () => {
    const created = await createRoom(currentTimeCode(), "203.0.113.8");
    const { room, sessionToken } = await created.json<any>();

    const res = await app.request(
      `/api/rooms/${room.id}?token=${encodeURIComponent(sessionToken)}`,
      {},
      env
    );
    expect(res.status).toBe(200);
  });

  it("rejects entry to a room that does not exist", async () => {
    const res = await app.request(`/api/rooms/does-not-exist`, {}, env);
    expect(res.status).toBe(404);
  });

  it("rejects requests to an expired room", async () => {
    const pinHash = await hashPin("0000");
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO rooms (id, room_name, pin_hash, created_at, expires_at, status, storage_bytes_used)
       VALUES (?, ?, ?, ?, ?, 'active', 0)`
    )
      .bind("expired-room", "OldTrip", pinHash, now - 1000, now - 1)
      .run();

    const res = await app.request("/api/rooms/expired-room", {}, env);
    expect(res.status).toBe(410);
  });
});

describe("hidden lifetime extension", () => {
  it("pushes expires_at out by ROOM_LIFETIME_MS", async () => {
    const created = await createRoom(currentTimeCode(), "203.0.113.9");
    const { room, sessionToken } = await created.json<any>();

    const res = await app.request(
      `/api/rooms/${room.id}/extend`,
      { method: "POST", headers: { Authorization: `Bearer ${sessionToken}` } },
      env
    );
    expect(res.status).toBe(200);
    const { expiresAt } = await res.json<any>();
    expect(expiresAt).toBeGreaterThan(room.expiresAt);
    expect(expiresAt - room.expiresAt).toBeCloseTo(24 * 60 * 60 * 1000, -3);
  });

  it("rejects extension without a valid session", async () => {
    const created = await createRoom(currentTimeCode(), "203.0.113.10");
    const { room } = await created.json<any>();

    const res = await app.request(`/api/rooms/${room.id}/extend`, { method: "POST" }, env);
    expect(res.status).toBe(401);
  });

  // Extension only works through POST /:id/extend on a still-live room (see
  // the test above) — there's no "revive after the fact" path. Touching a
  // room past its expiry lazily wipes its D1 row + R2 objects immediately
  // (see lib/roomCleanup.ts), so it can't come back even if something edits
  // expires_at directly afterward; the row is simply gone.
  it("permanently deletes a room the moment it's touched past expiry", async () => {
    const pinHash = await hashPin("0000");
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO rooms (id, room_name, pin_hash, created_at, expires_at, status, storage_bytes_used)
       VALUES (?, ?, ?, ?, ?, 'active', 0)`
    )
      .bind("soon-expiring-room", "SoonRoom", pinHash, now, now + 50)
      .run();

    const { createSessionToken } = await import("../src/lib/session");
    const { LIMITS } = await import("../../shared/types");
    const sessionToken = await createSessionToken(
      (env as any).SESSION_SECRET,
      "soon-expiring-room",
      now + LIMITS.SESSION_TOKEN_LIFETIME_MS
    );

    await new Promise((resolve) => setTimeout(resolve, 60));

    const blockedRes = await app.request(
      "/api/rooms/soon-expiring-room",
      { headers: { Authorization: `Bearer ${sessionToken}` } },
      env
    );
    expect(blockedRes.status).toBe(410);

    const row = await env.DB.prepare("SELECT id FROM rooms WHERE id = ?")
      .bind("soon-expiring-room")
      .first();
    expect(row).toBeNull();

    // Nothing short of creating a brand new room brings it back — updating
    // expires_at on a row that no longer exists is a no-op.
    await env.DB.prepare("UPDATE rooms SET expires_at = ? WHERE id = ?")
      .bind(Date.now() + 24 * 60 * 60 * 1000, "soon-expiring-room")
      .run();

    const stillGoneRes = await app.request(
      "/api/rooms/soon-expiring-room",
      { headers: { Authorization: `Bearer ${sessionToken}` } },
      env
    );
    expect(stillGoneRes.status).toBe(404);
  });
});

describe("immediate room deletion", () => {
  it("deletes a room and its files on request", async () => {
    const created = await createRoom(currentTimeCode(), "203.0.113.11");
    const { room, sessionToken } = await created.json<any>();

    await app.request(
      `/api/rooms/${room.id}/files?name=test.jpg&type=image/jpeg`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${sessionToken}`, "Content-Length": "3" },
        body: new TextEncoder().encode("abc"),
      },
      env
    );

    const res = await app.request(
      `/api/rooms/${room.id}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${sessionToken}` } },
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.deleted).toBe(true);

    const roomRow = await env.DB.prepare("SELECT id FROM rooms WHERE id = ?").bind(room.id).first();
    expect(roomRow).toBeNull();
    const fileRow = await env.DB.prepare("SELECT id FROM files WHERE room_id = ?").bind(room.id).first();
    expect(fileRow).toBeNull();

    const afterRes = await app.request(
      `/api/rooms/${room.id}`,
      { headers: { Authorization: `Bearer ${sessionToken}` } },
      env
    );
    expect(afterRes.status).toBe(404);
  });

  it("rejects deletion without a valid session", async () => {
    const created = await createRoom(currentTimeCode(), "203.0.113.12");
    const { room } = await created.json<any>();

    const res = await app.request(`/api/rooms/${room.id}`, { method: "DELETE" }, env);
    expect(res.status).toBe(401);
  });

  it("returns not found when deleting a room that doesn't exist", async () => {
    const res = await app.request("/api/rooms/does-not-exist", { method: "DELETE" }, env);
    expect(res.status).toBe(404);
  });
});
