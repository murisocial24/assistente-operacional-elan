import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verificarToken, podeAcederModulo } from "@/lib/auth";
import { crmProvider } from "@/lib/config";
import { consultarKpisComercial } from "@/lib/zoho";

export const runtime = "nodejs";
export const maxDuration = 300;

function pendente(ano: number, mes: number) {
  return {
    ligado: false,
    ano,
    mes,
    vendas_mes: 0,
    vendas_ano: 0,
    ytd_atual: 0,
    ytd_homologo: 0,
    evolucao_homologa: null,
    meses: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, valor: 0 })),
    melhor_comercial_mes: null,
    top_comerciais_ano: [],
    top_clientes_ano: [],
  };
}

export async function GET() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = agora.getMonth() + 1;

  const jar = await cookies();
  const sessao = await verificarToken(jar.get("sessao")?.value);
  if (!podeAcederModulo(sessao, "comercial")) {
    return NextResponse.json(pendente(ano, mes), { status: 403 });
  }

  // Só o Zoho está implementado. Sem CRM (ou outro), devolve zeros.
  if (crmProvider() !== "zoho") {
    return NextResponse.json(pendente(ano, mes));
  }

  try {
    const kpis = await consultarKpisComercial();
    return NextResponse.json(kpis);
  } catch {
    return NextResponse.json({
      ...pendente(ano, mes),
      erro: "Não foi possível calcular as métricas comerciais neste momento.",
    });
  }
}
