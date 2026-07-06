import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verificarToken, podeAcederModulo } from "@/lib/auth";
import { erpProvider } from "@/lib/config";
import { metricasVendasComCache } from "@/lib/moloni";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const jar = await cookies();
  const sessao = await verificarToken(jar.get("sessao")?.value);
  if (!podeAcederModulo(sessao, "gestao")) {
    return NextResponse.json({ erro: "Sem acesso.", ligado: false }, { status: 403 });
  }
  if (erpProvider() !== "moloni") {
    return NextResponse.json({ erro: "Indisponível para este ERP.", ligado: false }, { status: 404 });
  }
  try {
    const forcar = new URL(req.url).searchParams.get("fresh") === "1";
    const ano = new Date().getFullYear();
    const { data, cache } = await metricasVendasComCache(ano, forcar);
    return NextResponse.json({ ...data, _cache: cache });
  } catch (e) {
    return NextResponse.json(
      { erro: e instanceof Error ? e.message : "Erro ao calcular métricas.", ligado: false },
      { status: 200 }
    );
  }
}
