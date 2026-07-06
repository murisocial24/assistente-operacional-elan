import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verificarToken, podeAcederModulo } from "@/lib/auth";
import { erpProvider } from "@/lib/config";
import { margemComEstado, isConnected, garantirRefreshCarregado } from "@/lib/moloni";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const jar = await cookies();
  const sessao = await verificarToken(jar.get("sessao")?.value);
  if (!podeAcederModulo(sessao, "gestao")) {
    return NextResponse.json({ estado: "erro", erro: "Sem acesso." }, { status: 403 });
  }
  if (erpProvider() !== "moloni") {
    return NextResponse.json({ estado: "erro", erro: "Indisponível." }, { status: 404 });
  }
  await garantirRefreshCarregado();
  if (!isConnected()) {
    return NextResponse.json({ estado: "erro", erro: "Moloni não está ligado." }, { status: 200 });
  }
  const forcar = new URL(req.url).searchParams.get("fresh") === "1";
  const ano = new Date().getFullYear();
  const { estado, data } = await margemComEstado(ano, forcar);
  return NextResponse.json({ estado, data });
}
