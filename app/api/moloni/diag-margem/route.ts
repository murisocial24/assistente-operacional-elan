import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verificarToken, podeAcederModulo } from "@/lib/auth";
import { diagnosticoMargem, isConnected, garantirRefreshCarregado } from "@/lib/moloni";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const jar = await cookies();
  const sessao = await verificarToken(jar.get("sessao")?.value);
  if (!podeAcederModulo(sessao, "gestao")) {
    return NextResponse.json({ erro: "Sem acesso." }, { status: 403 });
  }
  await garantirRefreshCarregado();
  if (!isConnected()) {
    return NextResponse.json({ erro: "Moloni não está ligado." }, { status: 400 });
  }
  try {
    const n = Number(new URL(req.url).searchParams.get("n")) || 40;
    return NextResponse.json(await diagnosticoMargem(Math.min(Math.max(n, 5), 150)));
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "erro" }, { status: 500 });
  }
}
