import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verificarToken, podeAcederModulo } from "@/lib/auth";

// Sessão assinada por utilizador. Sem sessão válida -> /login.
// Bloqueia também o acesso direto a um módulo a que o utilizador não tem direito.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/brand") ||
    /\.(webp|png|jpe?g|svg|gif|ico|css|js|map|woff2?)$/.test(pathname);

  if (isPublic) return NextResponse.next();

  const sessao = await verificarToken(req.cookies.get("sessao")?.value);

  if (!sessao) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Páginas de módulo: /gestao, /logistica, /comercial
  const m = pathname.match(/^\/(gestao|logistica|comercial)(\/|$)/);
  if (m && !podeAcederModulo(sessao, m[1])) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
