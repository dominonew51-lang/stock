import { env } from "cloudflare:workers";
import { sameOriginMutation } from "../../../device-session";
import { resetPassword } from "../../../password-auth";

export async function POST(request: Request) {
  if (!sameOriginMutation(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
  try {
    const payload = await request.json() as { setupToken?: unknown; password?: unknown };
    const workerEnv = env as typeof env & { MINIMALISM_SETUP_TOKEN?: string };
    const result = await resetPassword(typeof payload.setupToken === "string" ? payload.setupToken : "", typeof payload.password === "string" ? payload.password : "", workerEnv.MINIMALISM_SETUP_TOKEN);
    return Response.json({ ok: true, trusted: true, expiresAt: result.expiresAt }, { headers: result.cookie ? { "set-cookie": result.cookie } : undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : "密码重置失败";
    return Response.json({ error: message }, { status: 403 });
  }
}
