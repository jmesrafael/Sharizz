import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "../src/lib/session";

describe("session tokens", () => {
  const secret = "unit-test-secret";

  it("verifies a token it issued for the right room", async () => {
    const token = await createSessionToken(secret, "room-1", Date.now() + 60_000);
    expect(await verifySessionToken(secret, token, "room-1")).toBe(true);
  });

  it("rejects a token for the wrong room", async () => {
    const token = await createSessionToken(secret, "room-1", Date.now() + 60_000);
    expect(await verifySessionToken(secret, token, "room-2")).toBe(false);
  });

  it("rejects an expired token", async () => {
    const token = await createSessionToken(secret, "room-1", Date.now() - 1000);
    expect(await verifySessionToken(secret, token, "room-1")).toBe(false);
  });

  it("rejects a tampered token", async () => {
    const token = await createSessionToken(secret, "room-1", Date.now() + 60_000);
    const tampered = token.slice(0, -2) + "xx";
    expect(await verifySessionToken(secret, tampered, "room-1")).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken(secret, "room-1", Date.now() + 60_000);
    expect(await verifySessionToken("other-secret", token, "room-1")).toBe(false);
  });
});
