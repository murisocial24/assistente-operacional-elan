// =====================================================================
// MOLONI — API clássica (www.moloni.pt/dev)
// ---------------------------------------------------------------------
// OAuth 2.0 com authorization_code: o utilizador autoriza no Moloni e é
// reencaminhado para /api/moloni/callback. Os pedidos de token são GET; os
// pedidos de dados são POST para https://api.moloni.pt/v1/<classe>/<metodo>/.
//
// VALIDADE DOS TOKENS (importante e diferente do TOC Online):
//   - access_token: 1 hora
//   - refresh_token: 14 dias E ROTACIONA a cada renovação (vem sempre um novo).
// Por isso a variável MOLONI_REFRESH_TOKEN serve para arrancar a ligação, mas
// fica desatualizada após a 1.ª renovação automática. A persistência fiável do
// refresh token (para sobreviver a reinícios) é decidida na fase de produção.
// =====================================================================

const API_BASE = process.env.MOLONI_API_BASE || "https://api.moloni.pt/v1";
const AUTHORIZE_URL = process.env.MOLONI_AUTHORIZE_URL || "https://www.moloni.pt/ac/root/oauth/";

let accessToken: string | undefined = process.env.MOLONI_ACCESS_TOKEN || undefined;
let refreshToken: string | undefined = process.env.MOLONI_REFRESH_TOKEN || undefined;
let accessExpiraEm = 0; // epoch ms

export function getOAuthConfig() {
  return {
    apiBase: API_BASE,
    authorizeUrl: AUTHORIZE_URL,
    clientId: process.env.MOLONI_CLIENT_ID || "",
    clientSecret: process.env.MOLONI_CLIENT_SECRET || "",
  };
}

export function setTokens(access?: string, refresh?: string, expiresIn?: number): void {
  if (access) accessToken = access;
  if (refresh) refreshToken = refresh;
  if (expiresIn) accessExpiraEm = Date.now() + (expiresIn - 60) * 1000; // 60s de margem
}

export function isConnected(): boolean {
  return Boolean(refreshToken || accessToken);
}

export function redirectUri(req: Request): string {
  if (process.env.MOLONI_REDIRECT_URI) return process.env.MOLONI_REDIRECT_URI;
  const base =
    process.env.APP_BASE_URL ||
    `${req.headers.get("x-forwarded-proto") ?? "https"}://${req.headers.get("host") ?? ""}`;
  return `${base}/api/moloni/callback`;
}

export function authUrl(redirect: string): string {
  const { clientId } = getOAuthConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

type TokenResp = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

export async function trocarCodigo(code: string, redirect: string): Promise<TokenResp> {
  const { clientId, clientSecret } = getOAuthConfig();
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirect,
    client_secret: clientSecret,
    code,
  });
  const r = await fetch(`${API_BASE}/grant/?${params.toString()}`);
  const j = (await r.json()) as TokenResp;
  if (j.access_token) setTokens(j.access_token, j.refresh_token, j.expires_in);
  return j;
}

async function refrescar(): Promise<void> {
  const { clientId, clientSecret } = getOAuthConfig();
  if (!refreshToken) throw new Error("Sem refresh token — é preciso ligar o Moloni.");
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const r = await fetch(`${API_BASE}/grant/?${params.toString()}`);
  const j = (await r.json()) as TokenResp;
  if (!j.access_token) {
    throw new Error(
      `Falha ao renovar o token do Moloni: ${j.error_description || j.error || "desconhecido"}`
    );
  }
  setTokens(j.access_token, j.refresh_token, j.expires_in);
}

export async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < accessExpiraEm) return accessToken;
  await refrescar();
  if (!accessToken) throw new Error("Não foi possível obter o access token do Moloni.");
  return accessToken;
}

// Pedido genérico à API (POST com JSON; access_token e flags vão na query string).
export async function apiPost(
  classeMetodo: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  const token = await getAccessToken();
  const url = `${API_BASE}/${classeMetodo}/?access_token=${encodeURIComponent(
    token
  )}&json=true&human_errors=true`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return r.json();
}

// Empresa a usar nos pedidos. MOLONI_COMPANY_ID tem prioridade; senão usa a 1.ª.
export async function getCompanyId(): Promise<number | null> {
  if (process.env.MOLONI_COMPANY_ID) return Number(process.env.MOLONI_COMPANY_ID);
  const companies = (await apiPost("companies/getAll")) as Array<{ company_id?: number }>;
  if (Array.isArray(companies) && companies.length && companies[0].company_id) {
    return companies[0].company_id;
  }
  return null;
}
