import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verificarToken, podeAcederModulo } from "@/lib/auth";
import { erpProvider } from "@/lib/config";
import { consultarKpisGestao } from "@/lib/toconline";
import { consultarKpisGestao as kpisMoloni } from "@/lib/moloni";

export const runtime = "nodejs";
export const maxDuration = 300;

function pendente(ano: number) {
  return {
    ligado: false,
    ano,
    meses: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, receitas: 0, despesas: 0 })),
    total_receitas: 0,
    total_despesas: 0,
    evolucao_receitas: null,
    evolucao_despesas: null,
    liquidez_media: null,
  };
}

export async function GET() {
  const ano = new Date().getFullYear();

  const jar = await cookies();
  const sessao = await verificarToken(jar.get("sessao")?.value);
  if (!podeAcederModulo(sessao, "gestao")) {
    return NextResponse.json(pendente(ano), { status: 403 });
  }

  const erp = erpProvider();
  try {
    if (erp === "toconline") return NextResponse.json(await consultarKpisGestao(ano));
    if (erp === "moloni") return NextResponse.json(await kpisMoloni(ano));
    return NextResponse.json(pendente(ano));
  } catch {
    return NextResponse.json({
      ...pendente(ano),
      erro: "Não foi possível calcular as métricas neste momento.",
    });
  }
}
