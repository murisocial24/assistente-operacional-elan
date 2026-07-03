import { NextResponse } from "next/server";
import { trocarCodigo, redirectUri } from "@/lib/moloni";

export const runtime = "nodejs";

// Passo 2/3: o Moloni devolve ?code=... aqui; trocamos por access + refresh token.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const erro = url.searchParams.get("error");

  if (erro) {
    return new NextResponse(`Erro devolvido pelo Moloni: ${erro}`, { status: 400 });
  }
  if (!code) {
    return new NextResponse("Falta o parâmetro 'code' no retorno do Moloni.", { status: 400 });
  }

  const redirect = redirectUri(req);
  const tok = await trocarCodigo(code, redirect);

  if (!tok.access_token) {
    return new NextResponse(
      `Falha na troca do código: ${tok.error_description || tok.error || "desconhecido"}`,
      { status: 400 }
    );
  }

  const refresh = tok.refresh_token ?? "";
  const html = `<!doctype html><meta charset="utf-8">
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:48px auto;padding:0 20px;line-height:1.6;color:#15171c">
  <h2 style="margin-bottom:8px">Moloni ligado ✅</h2>
  <p>A ligação ao Moloni foi estabelecida com sucesso.</p>
  <p>Para a ligação sobreviver a reinícios da aplicação, copie o valor abaixo e cole-o na variável
  <b>MOLONI_REFRESH_TOKEN</b> no Render (Environment):</p>
  <pre style="background:#f4f4f5;padding:14px;border-radius:8px;white-space:pre-wrap;word-break:break-all;font-size:13px">${refresh}</pre>
  <p style="color:#6b7280;font-size:14px">Nota: no Moloni este código muda a cada renovação e expira em 14 dias — a persistência definitiva é tratada na fase de produção.</p>
  <p style="margin-top:24px"><a href="/" style="color:#15171c">← Voltar à aplicação</a></p>
</body>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
