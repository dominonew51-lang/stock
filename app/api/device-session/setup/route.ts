import { env } from "cloudflare:workers";
import { sameOriginMutation } from "../../../device-session";
import { setupPassword } from "../../../password-auth";

export async function POST(request: Request) {
  if (!sameOriginMutation(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
  try {
    const payload = await request.json() as { setupToken?: unknown; password?: unknown };
    const setupToken = typeof payload.setupToken === "string" ? payload.setupToken : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    const workerEnv = env as typeof env & { MINIMALISM_SETUP_TOKEN?: string };
    const result = await setupPassword(setupToken, password, workerEnv.MINIMALISM_SETUP_TOKEN);
    return Response.json(
      { ok: true, trusted: true, expiresAt: result.expiresAt },
      { headers: result.cookie ? { "set-cookie": result.cookie } : undefined },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "首次设置失败";
    const status = /尚未配置/.test(message) ? 503 : /已经设置/.test(message) ? 409 : 403;
    return Response.json({ error: message }, { status });
  }
}
