import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f9fc",
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  const title = "Minimalism";
  const description = "聚合美股、A股与基金持仓的个人资产配置看板。";
  return {
    title, description,
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable:true, title:"Minimalism", statusBarStyle:"default" },
    icons: { icon: "/minimalism-icon.svg", shortcut: "/minimalism-icon.svg", apple:"/minimalism-icon-192.png" },
    openGraph: { title, description, images: [{ url: image, width: 1792, height: 896 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
