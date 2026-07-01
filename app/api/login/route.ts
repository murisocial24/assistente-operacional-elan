import { NextResponse } from "next/server";
import { validarCredenciais, criarToken, getUtilizadores } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let username = "";
  let password = "";
  try {
    const body = await req.json();
    username = body?.username ?? "";
    password = body?.password ?? "";
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (getUtilizadores().length === 0) {
    return NextResponse.json(
      {
        ok: false,
        erro: "Não há utilizadores configurados no servidor (define APP_USERS ou APP_PASSWORD).",
      },
      { status: 500 }
    );
  }

  const sessao = validarCredenciais(username, password);
  if (!sessao) {
    return NextResponse.json({ ok: false, erro: "Dados de acesso incorretos." }, { status: 401 });
  }

  const token = await criarToken(sessao);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("sessao", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 dias
  });
  return res;
}
