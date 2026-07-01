import { NextResponse } from "next/server";
import { isConnected } from "@/lib/zoho";

export const runtime = "nodejs";

// Diagnóstico de configuração do Zoho. Mostra QUE variáveis o servidor está a ver,
// sem revelar valores secretos. Acede com sessão iniciada: /api/zoho/diag
export async function GET() {
  return NextResponse.json({
    ligado: isConnected(),
    tem_client_id: Boolean(process.env.ZOHO_CLIENT_ID),
    tem_client_secret: Boolean(process.env.ZOHO_CLIENT_SECRET),
    tem_refresh_token: Boolean(process.env.ZOHO_REFRESH_TOKEN),
    accounts_base: process.env.ZOHO_ACCOUNTS_BASE || "(em falta)",
    api_base: process.env.ZOHO_API_BASE || "(em falta)",
    redirect_uri: process.env.ZOHO_REDIRECT_URI || "(em falta)",
  });
}
