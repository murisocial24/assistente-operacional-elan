import { NextResponse } from "next/server";
import { getOAuthConfig, setTokens } from "@/lib/toconline";

export const runtime = "nodejs";

function appBaseUrl(req: Request): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "";
  return `${proto}://${host}`;
}

function pagina(titulo: string, corpo: string): NextResponse {
  const html = `<!doctype html><html lang="pt"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo}</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f7f7f5;color:#1f1f1d;margin:0;padding:24px;line-height:1.6}
  .card{max-width:640px;margin:24px auto;background:#fff;border:1px solid #e3e3df;border-radius:14px;padding:24px}
  h1{font-size:20px;margin:0 0 12px}
  code,.token{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;background:#f1efe8;border:1px solid #e3e3df;border-radius:8px;padding:10px;display:block;word-break:break-all;margin:8px 0}
  a.btn{display:inline-block;margin-top:16px;background:#2f6f4f;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px}
  .aviso{background:#faeeda;border:1px solid #ef9f27;border-radius:8px;padding:12px;font-size:14px}
</style></head><body><div class="card">${corpo}</div></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const erroOAuth = url.searchParams.get("error");

  // O cookie do verifier PKCE foi gravado na rota /connect.
  const cookieHeader = req.headers.get("cookie") ?? "";
  const verifier = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("toc_pkce="))
    ?.slice("toc_pkce=".length);

  if (erroOAuth) {
    return pagina("Erro", `<h1>Autorização recusada</h1><p>O TOC Online devolveu: <code>${erroOAuth}</code></p><a class="btn" href="/">Voltar</a>`);
  }
  if (!code || !verifier) {
    return pagina(
      "Erro",
      `<h1>Não foi possível concluir</h1><p>Faltou o código de autorização ou a sessão expirou. Tenta novamente.</p><a class="btn" href="/api/toconline/connect">Ligar de novo</a>`
    );
  }

  const { oauthBase, clientId, clientSecret } = getOAuthConfig();
  const redirectUri =
    process.env.TOCONLINE_REDIRECT_URI ?? `${appBaseUrl(req)}/api/toconline/callback`;

  let tokenRes: Response;
  try {
    tokenRes = await fetch(`${oauthBase}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        client_id: clientId,
        client_secret: clientSecret,
        scope: "commercial",
      }),
    });
  } catch {
    return pagina("Erro", `<h1>Erro de ligação</h1><p>Não foi possível contactar o TOC Online.</p><a class="btn" href="/api/toconline/connect">Tentar de novo</a>`);
  }

  if (!tokenRes.ok) {
    const detalhe = await tokenRes.text().catch(() => "");
    return pagina(
      "Erro",
      `<h1>O TOC Online recusou o pedido (${tokenRes.status})</h1>
       <p>A causa mais comum é o endereço de retorno (redirect URI) não coincidir com o registado no TOC Online.</p>
       <p>Endereço usado:</p><code>${redirectUri}</code>
       <p style="font-size:13px;color:#6b6b66">Detalhe técnico: ${detalhe.slice(0, 300)}</p>
       <a class="btn" href="/api/toconline/connect">Tentar de novo</a>`
    );
  }

  const data = (await tokenRes.json()) as { access_token?: string; refresh_token?: string };
  setTokens(data.access_token, data.refresh_token);

  const refresh = data.refresh_token ?? "(não devolvido)";

  // Limpa o cookie do verifier.
  const res = pagina(
    "Ligado ao TOC Online",
    `<h1>✅ Ligado ao TOC Online</h1>
     <p>A plataforma já consegue consultar a faturação. Podes voltar e fazer perguntas.</p>
     <div class="aviso">
       <strong>Para manter a ligação após reinícios do servidor</strong>, copia o código abaixo
       e guarda-o no Render, na variável de ambiente <code>TOCONLINE_REFRESH_TOKEN</code>.
       Mantém-no privado.
     </div>
     <p>refresh_token:</p>
     <div class="token">${refresh}</div>
     <a class="btn" href="/">Voltar ao assistente</a>`
  );
  res.cookies.set("toc_pkce", "", { path: "/", maxAge: 0 });
  return res;
}
