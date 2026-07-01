import { NextResponse } from "next/server";
import { trocarCodigo } from "@/lib/zoho";

export const runtime = "nodejs";

function pagina(titulo: string, corpo: string) {
  return new NextResponse(
    `<!doctype html><html lang="pt"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo}</title>
<style>
body{font-family:Inter,system-ui,sans-serif;background:#f4f7f5;color:#14201c;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px}
.card{background:#fff;border:1px solid #e4eae7;border-radius:18px;padding:30px;max-width:560px;box-shadow:0 10px 40px rgba(20,32,28,.1)}
h1{font-size:20px;margin:0 0 10px}
p{color:#45524d;font-size:14px;line-height:1.6}
code{display:block;background:#eef2f0;border:1px solid #e4eae7;border-radius:10px;padding:12px;margin:12px 0;font-size:12px;word-break:break-all}
a{color:#0f7a5a;font-weight:600}
</style></head><body><div class="card">${corpo}</div></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const erro = url.searchParams.get("error");

  if (erro || !code) {
    return pagina(
      "Erro",
      `<h1>Não foi possível ligar ao Zoho CRM</h1><p>Motivo: ${erro ?? "não foi devolvido código de autorização"}.</p><p><a href="/">Voltar</a></p>`
    );
  }

  try {
    const j = await trocarCodigo(code);
    if (!j.refresh_token) {
      return pagina(
        "Atenção",
        `<h1>Ligação parcial</h1><p>O Zoho não devolveu um <strong>refresh token</strong>. Isto costuma acontecer se a app já tinha sido autorizada antes. Revoga o acesso em Zoho (Definições &gt; Apps ligadas) e tenta de novo.</p><p><a href="/">Voltar</a></p>`
      );
    }
    return pagina(
      "Zoho CRM ligado",
      `<h1>✓ Zoho CRM autorizado</h1>
      <p>Copia o <strong>refresh token</strong> abaixo e coloca-o no Render, na variável de ambiente <strong>ZOHO_REFRESH_TOKEN</strong>. Depois faz "Save, rebuild, and deploy".</p>
      <code>${j.refresh_token}</code>
      <p>Guarda este valor com cuidado — dá acesso de leitura ao teu CRM.</p>
      <p><a href="/">Voltar à aplicação</a></p>`
    );
  } catch (e) {
    return pagina(
      "Erro",
      `<h1>Erro ao trocar o código</h1><p>${e instanceof Error ? e.message : "erro desconhecido"}.</p><p>Verifica o Client ID, o Client Secret e a região (deve ser a europeia).</p><p><a href="/">Voltar</a></p>`
    );
  }
}
