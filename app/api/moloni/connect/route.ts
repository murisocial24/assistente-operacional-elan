import { NextResponse } from "next/server";
import { getOAuthConfig, authUrl, redirectUri } from "@/lib/moloni";

export const runtime = "nodejs";

// Passo 1 do OAuth: reencaminha o utilizador para o Moloni autorizar.
export async function GET(req: Request) {
  const { clientId } = getOAuthConfig();
  if (!clientId) {
    return new NextResponse("Falta a variável MOLONI_CLIENT_ID no servidor.", { status: 500 });
  }
  const redirect = redirectUri(req);
  return NextResponse.redirect(authUrl(redirect));
}
