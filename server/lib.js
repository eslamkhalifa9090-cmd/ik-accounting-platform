// أدوات مشتركة للـ API: ردود JSON، التشفير، الجلسات، والصلاحيات

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export const fail = (status, message) => {
  throw new HttpError(status, message);
};

export async function body(request) {
  try {
    return await request.json();
  } catch {
    fail(400, "البيانات المبعوتة مش مفهومة.");
  }
}

// ---------- أرقام وتليفونات ----------
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export function toLatinDigits(s) {
  return String(s ?? "").replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d));
}

// 01012345678 / +201012345678 / 00201012345678 → 01012345678
export function normalizePhone(raw) {
  let p = toLatinDigits(raw).replace(/[\s\-()+]/g, "");
  if (!p) return null;
  if (p.startsWith("0020")) p = "0" + p.slice(4);
  else if (p.startsWith("20") && p.length === 12) p = "0" + p.slice(2);
  return /^\d{8,15}$/.test(p) ? p : null;
}

export function normalizeEmail(raw) {
  const e = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

// ---------- التشفير ----------
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const PBKDF2_ITER = 100000; // أقصى عدد يسمح بيه Cloudflare Workers

export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER }, key, 256);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(password, stored) {
  const [, , salt, hash] = String(stored).split("$");
  if (!salt || !hash) return false;
  const again = (await hashPassword(password, salt)).split("$")[3];
  if (again.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= again.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export async function sha256(text) {
  return b64(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

export function randomToken(bytes = 32) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function validatePassword(p) {
  if (typeof p !== "string" || p.length < 6) fail(400, "الباسورد لازم يكون 6 حروف أو أرقام على الأقل.");
}

// ---------- الجلسات ----------
const COOKIE = "ik_session";
const SESSION_DAYS = 30;
export const MAX_DEVICES = 2;

export function readCookie(request, name = COOKIE) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export function sessionCookie(token, request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const maxAge = token ? SESSION_DAYS * 86400 : 0;
  return `${COOKIE}=${token || ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function createSession(db, userId, request) {
  const token = randomToken();
  const now = Date.now();
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(token), userId, now, now + SESSION_DAYS * 86400000, (request.headers.get("user-agent") || "").slice(0, 200))
    .run();
  // حد الأجهزة: نسيب أحدث جلستين بس لكل متدرب
  await db
    .prepare(
      `DELETE FROM sessions WHERE user_id = ?1 AND token_hash NOT IN
       (SELECT token_hash FROM sessions WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2)`
    )
    .bind(userId, MAX_DEVICES)
    .run();
  return token;
}

export async function currentUser(db, request) {
  const token = readCookie(request);
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.active, u.must_change, s.token_hash
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .bind(await sha256(token), Date.now())
    .first();
  if (!row || !row.active) return null;
  return row;
}

// ---------- الأسعار ----------
export function priceInfo(plan, today = new Date().toISOString().slice(0, 10)) {
  const price = Number(plan.price) || 0;
  let final = price;
  const active = plan.discount_type !== "none" && Number(plan.discount_value) > 0 && (!plan.discount_ends || plan.discount_ends >= today);
  if (active) {
    final = plan.discount_type === "percent" ? price * (1 - Number(plan.discount_value) / 100) : price - Number(plan.discount_value);
    final = Math.max(0, Math.round(final));
  }
  return { price, final, discounted: active && final < price, discount_ends: active ? plan.discount_ends : null };
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
