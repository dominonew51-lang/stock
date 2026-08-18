import { ensurePortfolioSchema, getD1 } from "../db";

const DEVICE_COOKIE = "__Host-minimalism_device";
const TRUST_SECONDS = 180 * 24 * 60 * 60;

type AccessSource = "chatgpt" | "device" | "local";

export type DeviceAccess = {
  authorized: boolean;
  source: AccessSource | null;
  trusted: boolean;
  ownerInitialized: boolean;
  userId: string | null;
};

function isLocalRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function ownerUserId() {
  const row = await getD1().prepare("SELECT user_id FROM portfolio_owners WHERE id = 1").first<{ user_id: string }>();
  return row?.user_id ?? null;
}

async function trustedCookieUserId(request: Request) {
  const token = cookieValue(request, DEVICE_COOKIE);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await getD1().prepare(`SELECT trusted_devices.user_id AS user_id
    FROM trusted_devices
    JOIN portfolio_owners ON portfolio_owners.id = 1
      AND portfolio_owners.user_id = trusted_devices.user_id
    WHERE trusted_devices.token_hash = ? AND trusted_devices.expires_at > ?`
  ).bind(tokenHash, now).first<{ user_id: string }>();
  if (row?.user_id) {
    await getD1().prepare("UPDATE trusted_devices SET last_seen_at = ? WHERE token_hash = ?")
      .bind(now, tokenHash).run();
  }
  return row?.user_id ?? null;
}

export async function getDeviceAccess(request: Request): Promise<DeviceAccess> {
  if (isLocalRequest(request)) {
    return { authorized: true, source: "local", trusted: true, ownerInitialized: true, userId: "local-preview-user" };
  }

  await ensurePortfolioSchema();
  const ownerId = await ownerUserId();
  const trustedUserId = await trustedCookieUserId(request);
  if (trustedUserId) {
    return { authorized: true, source: "device", trusted: true, ownerInitialized: true, userId: trustedUserId };
  }

  const headerUserId = request.headers.get("oai-authenticated-user-id");
  if (headerUserId && (!ownerId || ownerId === headerUserId)) {
    return { authorized: true, source: "chatgpt", trusted: false, ownerInitialized: Boolean(ownerId), userId: headerUserId };
  }

  return { authorized: false, source: null, trusted: false, ownerInitialized: Boolean(ownerId), userId: null };
}

export async function resolvePortfolioUserId(request: Request) {
  return (await getDeviceAccess(request)).userId;
}

export async function enrollTrustedDevice(request: Request) {
  if (isLocalRequest(request)) {
    return { ok: true, cookie: null, expiresAt: Date.now() + TRUST_SECONDS * 1000 };
  }

  const headerUserId = request.headers.get("oai-authenticated-user-id");
  if (!headerUserId) throw new Error("请先使用 ChatGPT 完成一次授权");

  await ensurePortfolioSchema();
  const d1 = getD1();
  const now = Math.floor(Date.now() / 1000);
  await d1.prepare("INSERT OR IGNORE INTO portfolio_owners (id, user_id, created_at) VALUES (1, ?, ?)")
    .bind(headerUserId, now).run();
  const ownerId = await ownerUserId();
  if (ownerId !== headerUserId) throw new Error("此账号不是该面板的所有者");

  return createTrustedDeviceForUser(headerUserId);
}

export async function createTrustedDeviceForUser(userId: string) {
  await ensurePortfolioSchema();
  const d1 = getD1();
  const now = Math.floor(Date.now() / 1000);
  await d1.prepare("DELETE FROM trusted_devices WHERE expires_at <= ?").bind(now).run();
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const expiresAt = now + TRUST_SECONDS;
  await d1.prepare(`INSERT INTO trusted_devices
    (token_hash, user_id, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)`
  ).bind(tokenHash, userId, now, expiresAt, now).run();

  const cookie = `${DEVICE_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${TRUST_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
  return { ok: true, cookie, expiresAt: expiresAt * 1000 };
}

export async function revokeTrustedDevice(request: Request) {
  await ensurePortfolioSchema();
  const token = cookieValue(request, DEVICE_COOKIE);
  if (token) {
    await getD1().prepare("DELETE FROM trusted_devices WHERE token_hash = ?")
      .bind(await hashToken(token)).run();
  }
  return `${DEVICE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function sameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
