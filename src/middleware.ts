import { NextResponse, type NextRequest } from "next/server";

/**
 * Simple password gate for the hosted demo.
 * Set DEMO_PASSWORD in Vercel → Settings → Environment Variables. Any username works.
 * If DEMO_PASSWORD is not set (e.g. local dev), the app is open.
 */
export function middleware(req: NextRequest) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const given = decoded.slice(decoded.indexOf(":") + 1);
      if (safeEqual(given, password)) return NextResponse.next();
    } catch {
      /* fall through to 401 */
    }
  }
  return new NextResponse("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Parking Decision Layer", charset="UTF-8"' },
  });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg).*)"],
};
