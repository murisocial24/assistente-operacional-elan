import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verificarToken, podeAcederModulo } from "@/lib/auth";
import { getModulos, erpProvider, crmProvider } from "@/lib/config";

export const runtime = "nodejs";

export async function GET() {
  const jar = await cookies();
  const sessao = await verificarToken(jar.get("sessao")?.value);
  if (!sessao) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  const modulos = getModulos().filter((m) => podeAcederModulo(sessao, m.key));

  return NextResponse.json({
    utilizador: sessao.u,
    modulos,
    providers: { erp: erpProvider(), crm: crmProvider() },
  });
}
