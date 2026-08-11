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
