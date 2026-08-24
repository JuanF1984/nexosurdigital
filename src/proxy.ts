import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Scoped exclusively to /turnos/* (see `matcher` below) — never runs for
// /mide/*, /api/mide/*, /api/energy-event or any public/marketing route, so
// it cannot affect MIDE or the rest of the site in any way.
//
// Two jobs:
// 1. Keep the Turnos Supabase session cookie fresh (standard @supabase/ssr
//    pattern — access tokens expire and must be refreshed on the server).
// 2. Redirect anonymous requests to /turnos/dashboard to /turnos/login, as a
//    first line of defense.
//
// This is NOT the only access check. This file (Next.js 16 "proxy"
// convention, the renamed successor to middleware.ts — see
// https://nextjs.org/docs/messages/middleware-to-proxy) can be skipped or
// misconfigured, and the docs explicitly call out not to rely on hiding a
// route alone — every protected Server Component also calls
// requireTurnosUser() (src/lib/turnos/auth.ts), which asks Supabase Auth
// directly whether the request is authenticated, independent of whatever
// happened here. See docs/turnos/dashboard.md.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.TURNOS_SUPABASE_URL;
  const anonKey = process.env.TURNOS_SUPABASE_ANON_KEY;

  const isDashboardRoute = request.nextUrl.pathname.startsWith("/turnos/dashboard");
  const isLoginRoute = request.nextUrl.pathname === "/turnos/login";

  if (!url || !anonKey) {
    // Turnos isn't configured yet in this environment: fail closed on the
    // protected route instead of letting the request through.
    if (isDashboardRoute) {
      return NextResponse.redirect(new URL("/turnos/login", request.url));
    }
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isDashboardRoute) {
    return NextResponse.redirect(new URL("/turnos/login", request.url));
  }

  if (user && isLoginRoute) {
    return NextResponse.redirect(new URL("/turnos/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/turnos/:path*"],
};
