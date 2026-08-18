import { ensurePortfolioSchema, getD1 } from "../db";
import { createTrustedDeviceForUser, ownerUserId } from "./device-session";

const AUTH_ID = 1;
const DEFAULT_OWNER_ID = "minimalism-owner";
// Cloudflare Workers Web Crypto currently accepts at most 100,000 PBKDF2 rounds.
const PASSWORD_ITERATIONS = 100_000;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const MAX_LOGIN_FAILURES = 5;

type PasswordRecord = {
  password_salt: string;
  password_hash: string;
  password_iterations: number;
};

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sha256(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function derivePasswordHash(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

async function secureEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index);
  }
  return difference === 0;
}

function clientAddress(request: Request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

async function clientKey(request: Request) {
  return sha256(`minimalism-login:${clientAddress(request)}`);
}

export async function isPasswordSetupRequired() {
  await ensurePortfolioSchema();
  const row = await getD1().prepare("SELECT id FROM app_auth WHERE id = ?").bind(AUTH_ID).first();
  return !row;
}

export async function setupPassword(setupToken: string, password: string, expectedSetupToken: string | undefined) {
  if (!expectedSetupToken) throw new Error("服务器尚未配置一次性设置密钥");
  if (!setupToken || !(await secureEqual(setupToken, expectedSetupToken))) throw new Error("一次性设置链接无效");
  if (password.length < 10) throw new Error("密码至少需要 10 个字符");

  await ensurePortfolioSchema();
  const d1 = getD1();
  const existing = await d1.prepare("SELECT id FROM app_auth WHERE id = ?").bind(AUTH_ID).first();
  if (existing) throw new Error("密码已经设置，请直接登录");

  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const passwordHash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS);
  const now = Math.floor(Date.now() / 1000);
  const result = await d1.prepare(`INSERT OR IGNORE INTO app_auth
    (id, password_salt, password_hash, password_iterations, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(AUTH_ID, bytesToBase64(salt), passwordHash, PASSWORD_ITERATIONS, now, now).run();
  if (!result.success || Number(result.meta.changes ?? 0) !== 1) throw new Error("密码已经设置，请直接登录");

  const userId = (await ownerUserId()) ?? DEFAULT_OWNER_ID;
  await d1.prepare("INSERT OR IGNORE INTO portfolio_owners (id, user_id, created_at) VALUES (1, ?, ?)")
    .bind(userId, now).run();
  return createTrustedDeviceForUser(userId);
}

export async function resetPassword(setupToken: string, password: string, expectedSetupToken: string | undefined) {
  if (!expectedSetupToken || !setupToken || !(await secureEqual(setupToken, expectedSetupToken))) throw new Error("一次性重置链接无效");
  if (password.length < 10) throw new Error("密码至少需要 10 个字符");
  await ensurePortfolioSchema();
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const passwordHash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS);
  const result = await getD1().prepare(`UPDATE app_auth SET password_salt = ?, password_hash = ?, password_iterations = ?, updated_at = ? WHERE id = ?`)
    .bind(bytesToBase64(salt), passwordHash, PASSWORD_ITERATIONS, Math.floor(Date.now() / 1000), AUTH_ID).run();
  if (!result.success || Number(result.meta.changes ?? 0) !== 1) throw new Error("尚未完成首次密码设置");
  return createTrustedDeviceForUser((await ownerUserId()) ?? DEFAULT_OWNER_ID);
}

export async function loginWithPassword(request: Request, password: string) {
  await ensurePortfolioSchema();
  const d1 = getD1();
  const key = await clientKey(request);
  const now = Math.floor(Date.now() / 1000);
  const attempts = await d1.prepare(`SELECT failed_count, window_started_at, blocked_until
    FROM login_attempts WHERE client_key = ?`
  ).bind(key).first<{ failed_count: number; window_started_at: number; blocked_until: number }>();
  if (attempts && attempts.blocked_until > now) {
    const minutes = Math.max(1, Math.ceil((attempts.blocked_until - now) / 60));
    throw new Error(`尝试次数过多，请 ${minutes} 分钟后再试`);
  }

  const record = await d1.prepare(`SELECT password_salt, password_hash, password_iterations
    FROM app_auth WHERE id = ?`
  ).bind(AUTH_ID).first<PasswordRecord>();
  if (!record) throw new Error("尚未完成首次密码设置");

  const candidate = await derivePasswordHash(password, base64ToBytes(record.password_salt), record.password_iterations);
  if (!(await secureEqual(candidate, record.password_hash))) {
    const inCurrentWindow = Boolean(attempts && now - attempts.window_started_at < LOGIN_WINDOW_SECONDS);
    const failedCount = inCurrentWindow ? attempts!.failed_count + 1 : 1;
    const windowStartedAt = inCurrentWindow ? attempts!.window_started_at : now;
    const blockedUntil = failedCount >= MAX_LOGIN_FAILURES ? now + LOGIN_WINDOW_SECONDS : 0;
    await d1.prepare(`INSERT INTO login_attempts
      (client_key, failed_count, window_started_at, blocked_until, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(client_key) DO UPDATE SET
        failed_count=excluded.failed_count,
        window_started_at=excluded.window_started_at,
        blocked_until=excluded.blocked_until,
        updated_at=excluded.updated_at`
    ).bind(key, failedCount, windowStartedAt, blockedUntil, now).run();
    throw new Error(failedCount >= MAX_LOGIN_FAILURES ? "尝试次数过多，请 15 分钟后再试" : "密码不正确");
  }

  await d1.prepare("DELETE FROM login_attempts WHERE client_key = ?").bind(key).run();
  const userId = await ownerUserId();
  if (!userId) throw new Error("资产所有者尚未初始化");
  return createTrustedDeviceForUser(userId);
}
