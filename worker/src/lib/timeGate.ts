// The only way in: type the current clock time (12-hour, zero-padded,
// no separator — "4:29 PM" becomes "0429") as the room-creation code.
// There's no account system, so this trades real authentication for
// obscurity — anyone watching network traffic or reading the bundle could
// work it out. It's paired with a per-IP attempt lockout (see rooms.ts)
// so it can't be brute-forced outright, but it is not real security.

const TIMEZONE = "Asia/Manila";
const TOLERANCE_MINUTES = 2;

function formatCode(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour12: true,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "12";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour.padStart(2, "0")}${minute.padStart(2, "0")}`;
}

export function isValidTimeCode(code: string, now: Date = new Date()): boolean {
  if (!/^\d{4}$/.test(code)) return false;
  for (let offset = -TOLERANCE_MINUTES; offset <= TOLERANCE_MINUTES; offset++) {
    const candidate = new Date(now.getTime() + offset * 60_000);
    if (formatCode(candidate) === code) return true;
  }
  return false;
}

// Test-only escape hatch: always produces a code that validates against `now`.
export function currentTimeCode(now: Date = new Date()): string {
  return formatCode(now);
}

export function friendlyRoomName(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);
}
