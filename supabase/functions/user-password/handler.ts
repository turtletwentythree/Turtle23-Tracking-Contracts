// user-password: email + password accounts for people outside Turtle23 (e.g. a partner without an Entra guest account).
// Request from Admin Tools > Users & Roles (Level 4-5, signed in):
//   { mode: "set", email, password? }  create the sign-in, or reset its password when it already exists
// Rules:
//   * The person must already have an Active row in Users & Roles; the Level there is what they get (Level 1-3 only)
//   * Not for the staff domain (EMAIL_DOMAIN, default turtle23.com): staff sign in with Microsoft 365
//   * No password given: a random one is made and returned once, for the Admin to pass on
//   * Every set or reset forces the person to choose a new password at their next sign-in
//   * Each set / reset is written to access_audit (Change History), never the password itself
// The service key stays in the function; the browser only sends its signed-in session.
export type Env = (name: string) => string | undefined;
export interface Deps {
  env: Env;
  userClient(authHeader: string): any;
  adminClient(): any;
  random?: (n: number) => Uint8Array;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const ADMIN_ROLES = ["admin", "root"];
const PASSWORD_ROLES = ["viewer", "user", "confidential"];
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
export const MIN_LENGTH = 10;
// No 0/O, 1/l/I, so a password read out over the phone is not mistyped
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function makePassword(random: (n: number) => Uint8Array, length = 12) {
  for (;;) {
    const p = Array.from(random(length), b => ALPHABET[b % ALPHABET.length]).join("");
    if (/[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p)) return p;
  }
}
export function passwordProblem(p: string) {
  if (p.length < MIN_LENGTH) return `รหัสผ่านต้องยาวอย่างน้อย ${MIN_LENGTH} ตัวอักษร`;
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข";
  return "";
}

async function admin(deps: Deps, authHeader: string) {
  if (!/^Bearer\s+\S+/.test(authHeader || "")) throw new HttpError(401, "Not signed in.");
  const client = deps.userClient(authHeader);
  const { data: u, error: ue } = await client.auth.getUser();
  if (ue || !u?.user) throw new HttpError(401, "Session expired. Please sign in again.");
  const { data: rows, error } = await client.rpc("my_access");
  const me = Array.isArray(rows) ? rows[0] : rows;
  if (error || !me || me.active === false || !ADMIN_ROLES.includes(String(me.role))) throw new HttpError(403, "ตั้งรหัสผ่านได้เฉพาะ Admin Level 4-5");
  return String(me.email || u.user.email || "").toLowerCase();
}

export async function handle(payload: any, ctx: { auth: string }, deps: Deps) {
  const by = await admin(deps, ctx.auth);
  if (payload?.mode !== "set") throw new HttpError(400, "Unknown mode.");
  const email = String(payload.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "อีเมลไม่ถูกต้อง");
  const staff = (deps.env("EMAIL_DOMAIN") || "turtle23.com").toLowerCase().replace(/^@/, "");
  if (email.split("@")[1] === staff) throw new HttpError(400, `พนักงาน @${staff} เข้าด้วย Microsoft 365 เท่านั้น ไม่ต้องตั้งรหัสผ่าน`);

  const db = deps.adminClient();
  const { data: row, error: re } = await db.from("user_access").select("email, display_name, role, active").eq("email", email).maybeSingle();
  if (re) throw new HttpError(500, `user_access: ${re.message}`);
  if (!row) throw new HttpError(400, `ยังไม่มี ${email} ใน Users & Roles: เพิ่มแถวและกด Save Users ก่อน`);
  if (row.active === false) throw new HttpError(400, `${email} ถูกปิดใช้งาน (Active) อยู่ใน Users & Roles`);
  if (!PASSWORD_ROLES.includes(String(row.role))) throw new HttpError(400, "บัญชีรหัสผ่านใช้ได้เฉพาะ Level 1-3 · Admin (Level 4-5) ต้องเข้าด้วย Microsoft 365");

  const given = typeof payload.password === "string" && payload.password !== "";
  const password = given ? String(payload.password) : makePassword(deps.random || (n => crypto.getRandomValues(new Uint8Array(n))));
  const bad = passwordProblem(password);
  if (bad) throw new HttpError(400, bad);

  const meta = { must_change_password: true };
  const app = { t23_password: true };
  // The sign-in already exists when the person signed in before (Microsoft) or had a password: profiles.id = auth user id
  const { data: prof } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
  let created = false;
  if (prof?.id) {
    const { error } = await db.auth.admin.updateUserById(prof.id, { password, email_confirm: true, user_metadata: meta, app_metadata: app });
    if (error) throw new HttpError(500, `ตั้งรหัสผ่านไม่สำเร็จ: ${error.message}`);
  } else {
    const { error } = await db.auth.admin.createUser({ email, password, email_confirm: true,
      user_metadata: { ...meta, full_name: row.display_name || email.split("@")[0] }, app_metadata: app });
    if (error) {
      if (/already|exists|registered/i.test(error.message)) throw new HttpError(409, `มีบัญชี ${email} อยู่แล้วแต่ไม่พบใน profiles กรุณาติดต่อผู้ดูแล Supabase`);
      throw new HttpError(500, `สร้างบัญชีไม่สำเร็จ: ${error.message}`);
    }
    created = true;
  }
  await db.from("access_audit").insert({ email, action: created ? "password created" : "password reset", new_role: row.role, new_active: row.active, source: "password", changed_by: by });
  return { success: true, email, created, password: given ? undefined : password, mustChange: true };
}
