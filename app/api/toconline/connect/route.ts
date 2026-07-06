import crypto from "crypto";
import { NextResponse } from "next/server";
import { getOAuthConfig } from "@/lib/toconline";

export const runtime = "nodejs";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function appBaseUrl(req: Request): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "";
  return `${proto}://${host}`;
}

export async function GET(req: Request) {
  const { oauthBase, clientId } = getOAuthConfig();

  if (!oauthBase || !clientId) {
    return new NextResponse(
      "Faltam as variáveis TOCONLINE_OAUTH_BASE e/ou TOCONLINE_CLIENT_ID no servidor.",
      { status: 500 }
    );
  }

  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());

  const redirectUri =
    process.env.TOCONLINE_REDIRECT_URI ?? `${appBaseUrl(req)}/api/toconline/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "commercial",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const res = NextResponse.redirect(`${oauthBase}/auth?${params.toString()}`);
  res.cookies.set("toc_pkce", verifier, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 minutos
  });
  return res;
}
