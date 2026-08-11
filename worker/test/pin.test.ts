import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "../src/lib/pin";

describe("pin hashing", () => {
  it("hashes a pin and never stores the plaintext", async () => {
    const hash = await hashPin("1234");
    expect(hash).not.toContain("1234");
    expect(hash.startsWith("pbkdf2$")).toBe(true);
  });

  it("verifies the correct pin", async () => {
    const hash = await hashPin("4821");
    expect(await verifyPin("4821", hash)).toBe(true);
  });

  it("rejects an incorrect pin", async () => {
    const hash = await hashPin("4821");
    expect(await verifyPin("0000", hash)).toBe(false);
  });

  it("rejects a malformed stored hash", async () => {
    expect(await verifyPin("1234", "not-a-real-hash")).toBe(false);
  });
});
