import { enrollTrustedDevice, getDeviceAccess, revokeTrustedDevice, sameOriginMutation } from "../../device-session";
import { isPasswordSetupRequired } from "../../password-auth";

export async function GET(request: Request) {
  try {
    const access = await getDeviceAccess(request);
    const setupRequired = access.authorized ? false : await isPasswordSetupRequired();
    return Response.json({ ...access, setupRequired }, { status: access.authorized ? 200 : 401 });
  } catch {
    return Response.json({ authorized: false, source: null, trusted: false, ownerInitialized: false, setupRequired: false }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!sameOriginMutation(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
  try {
    const result = await enrollTrustedDevice(request);
    const headers = new Headers();
    if (result.cookie) headers.set("set-cookie", result.cookie);
    return Response.json({ ok: true, trusted: true, expiresAt: result.expiresAt }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "设备授权失败";
    return Response.json({ error: message }, { status: 403 });
  }
}

export async function DELETE(request: Request) {
  if (!sameOriginMutation(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
  try {
    const cookie = await revokeTrustedDevice(request);
    return Response.json({ ok: true }, { headers: { "set-cookie": cookie } });
  } catch {
    return Response.json({ error: "撤销设备授权失败" }, { status: 500 });
  }
}
