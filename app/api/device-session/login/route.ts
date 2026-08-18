import { sameOriginMutation } from "../../../device-session";
import { loginWithPassword } from "../../../password-auth";

export async function POST(request: Request) {
  if (!sameOriginMutation(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
  try {
    const payload = await request.json() as { password?: unknown };
    const password = typeof payload.password === "string" ? payload.password : "";
    const result = await loginWithPassword(request, password);
    return Response.json(
      { ok: true, trusted: true, expiresAt: result.expiresAt },
      { headers: result.cookie ? { "set-cookie": result.cookie } : undefined },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败";
    const status = /尝试次数过多/.test(message) ? 429 : /尚未/.test(message) ? 409 : 403;
    return Response.json({ error: message }, { status });
  }
}
