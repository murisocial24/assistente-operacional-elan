import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verificarToken, podeAcederModulo } from "@/lib/auth";
import { erpProvider } from "@/lib/config";
import { consultarKpisGestao } from "@/lib/toconline";

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

  // Só o TOC Online está implementado. Para outro ERP (ex.: Moloni por ligar),
  // devolve métricas a zero sem tentar contactar o TOC Online.
  if (erpProvider() !== "toconline") {
    return NextResponse.json(pendente(ano));
  }

  try {
    const kpis = await consultarKpisGestao(ano);
    return NextResponse.json(kpis);
  } catch {
    return NextResponse.json({
      ...pendente(ano),
      erro: "Não foi possível calcular as métricas neste momento.",
    });
  }
}
