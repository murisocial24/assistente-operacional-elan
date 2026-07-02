import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verificarToken, podeAcederModulo } from "@/lib/auth";
import { erpProvider } from "@/lib/config";
import { consultarMetricasVendas } from "@/lib/moloni";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const jar = await cookies();
  const sessao = await verificarToken(jar.get("sessao")?.value);
  if (!podeAcederModulo(sessao, "gestao")) {
    return NextResponse.json({ erro: "Sem acesso.", ligado: false }, { status: 403 });
  }
  // Estas métricas (Fase A) estão implementadas para o Moloni.
  if (erpProvider() !== "moloni") {
    return NextResponse.json({ erro: "Indisponível para este ERP.", ligado: false }, { status: 404 });
  }
  try {
    const ano = new Date().getFullYear();
    return NextResponse.json(await consultarMetricasVendas(ano));
  } catch (e) {
    return NextResponse.json(
      { erro: e instanceof Error ? e.message : "Erro ao calcular métricas.", ligado: false },
      { status: 200 }
    );
  }
}
