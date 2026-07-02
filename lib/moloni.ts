import { metaVendasAno } from "@/lib/config";

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

// ---------------------------------------------------------------------
// PERSISTÊNCIA DO REFRESH TOKEN (o Moloni roda-o a cada renovação)
// Guardamos SEMPRE o token mais recente num armazenamento durável para
// sobreviver a reinícios/hibernação. Backends (auto-selecionados por env):
//   1) Upstash Redis (REST) — UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//      -> funciona mesmo no plano gratuito do Render.
//   2) Ficheiro em disco   — MOLONI_TOKEN_DIR (ex.: /data num disco persistente)
//      -> para instância paga com disco persistente.
//   3) Nenhum              -> usa apenas a variável MOLONI_REFRESH_TOKEN (frágil).
// A variável MOLONI_REFRESH_TOKEN passa a ser só o "arranque" inicial.
// ---------------------------------------------------------------------
const STORE_KEY = "moloni_refresh_token";
let refreshCarregado = false;

function storeTipo(): "upstash" | "file" | "none" {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return "upstash";
  if (process.env.MOLONI_TOKEN_DIR) return "file";
  return "none";
}

async function upstashCmd(cmd: unknown[]): Promise<{ result?: string | null }> {
  const url = process.env.UPSTASH_REDIS_REST_URL as string;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN as string;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("upstash");
  return (await r.json()) as { result?: string | null };
}

async function storeGet(): Promise<string | undefined> {
  try {
    if (storeTipo() === "upstash") {
      const j = await upstashCmd(["GET", STORE_KEY]);
      return j.result ? String(j.result) : undefined;
    }
    if (storeTipo() === "file") {
      const fs = await import("node:fs/promises");
      const v = await fs
        .readFile(`${process.env.MOLONI_TOKEN_DIR}/moloni_refresh.txt`, "utf8")
        .catch(() => "");
      return v.trim() || undefined;
    }
  } catch {
    /* silencioso */
  }
  return undefined;
}

async function storeSet(v: string): Promise<void> {
  try {
    if (storeTipo() === "upstash") {
      await upstashCmd(["SET", STORE_KEY, v]);
    } else if (storeTipo() === "file") {
      const fs = await import("node:fs/promises");
      const dir = process.env.MOLONI_TOKEN_DIR as string;
      await fs.mkdir(dir, { recursive: true }).catch(() => {});
      await fs.writeFile(`${dir}/moloni_refresh.txt`, v, "utf8");
    }
  } catch {
    /* silencioso */
  }
}

// Carrega o token mais recente do armazenamento durável (uma vez por processo).
export async function garantirRefreshCarregado(): Promise<void> {
  if (refreshCarregado) return;
  refreshCarregado = true;
  if (storeTipo() === "none") return;
  const v = await storeGet();
  if (v) refreshToken = v;
}

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
  if (j.refresh_token) await storeSet(j.refresh_token);
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
  if (j.refresh_token) await storeSet(j.refresh_token);
}

export async function getAccessToken(): Promise<string> {
  await garantirRefreshCarregado();
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

// =====================================================================
// LEITURA DE DADOS (faturação, vendas por cliente, KPIs, listagens)
// Espelha a lógica do conector TOC Online, adaptada aos campos do Moloni:
//   - total COM IVA por documento  -> net_value
//   - base sem IVA                  -> net_value - taxes_value
//   - IVA                           -> taxes_value
//   - por pagar                     -> net_value - reconciled_value
//   - cliente                       -> entity_name
//   - tipo de documento (SAF-T)     -> document_type.saft_code (FT/FS/FR)
//   - data                          -> date ("YYYY-MM-DDT..."), usamos os 10 primeiros
// =====================================================================

const TIPOS_FATURA = ["FT", "FS", "FR"]; // Fatura, Fatura Simplificada, Fatura-Recibo

const arred = (n: number) => Math.round(n * 100) / 100;
const dia10 = (s?: string) => (s ?? "").slice(0, 10); // "2026-07-01T00:00:00+0100" -> "2026-07-01"

type MoloniDoc = {
  date?: string;
  net_value?: number; // total COM IVA
  gross_value?: number; // ilíquido (antes de desconto/imposto)
  taxes_value?: number; // IVA
  reconciled_value?: number; // já liquidado
  entity_name?: string;
  customer_id?: number;
  supplier_id?: number;
  salesman_id?: number;
  document_type?: { saft_code?: string };
};

export const RECURSOS_MOLONI: Record<string, string> = {
  clientes: "customers",
  fornecedores: "suppliers",
  produtos: "products",
};

// Percorre os documentos de venda da empresa com paginação por offset.
// Só pára numa página vazia (robusto a limites de 'qty' do Moloni) ou no teto.
async function percorrerDocumentos(
  cb: (d: MoloniDoc) => void,
  opts: { desde?: string; maxDocs?: number } = {}
): Promise<boolean> {
  const companyId = await getCompanyId();
  if (!companyId) throw new Error("SEM_EMPRESA");

  const desde = opts.desde; // "YYYY-MM-DD": ignora tudo antes desta data
  const maxDocs = opts.maxDocs ?? 12000;
  const qty = 250;
  let offset = 0;
  let incompleto = false;

  while (true) {
    const lote = (await apiPost("documents/getAll", {
      company_id: companyId,
      offset,
      qty,
    })) as MoloniDoc[] | Record<string, unknown>;

    if (!Array.isArray(lote)) throw new Error("ERRO_API");
    if (lote.length === 0) break;

    let algumNoIntervalo = false;
    for (const d of lote) {
      cb(d);
      if (!desde || dia10(d.date) >= desde) algumNoIntervalo = true;
    }
    offset += lote.length;

    // Os documentos do Moloni vêm por data decrescente. Se uma página inteira
    // já é anterior a 'desde', o resto também é -> paramos (muito mais rápido).
    if (desde && !algumNoIntervalo) break;
    if (offset >= maxDocs) {
      incompleto = true;
      break;
    }
  }
  return incompleto;
}

// --------------------------- Faturação (agregado) ---------------------------

export type ResumoFaturacao = {
  data_inicio: string;
  data_fim: string;
  total_faturado: number;
  total_sem_iva: number;
  total_iva: number;
  valor_por_pagar: number;
  numero_de_faturas: number;
  moeda: string;
};

export async function consultarFaturacao(
  dataInicio: string,
  dataFim: string
): Promise<ResumoFaturacao> {
  if (!isConnected()) throw new Error("NAO_LIGADO");

  let total = 0,
    semIva = 0,
    iva = 0,
    porPagar = 0,
    contagem = 0;

  await percorrerDocumentos((d) => {
    const data = dia10(d.date);
    if (data < dataInicio || data > dataFim) return;
    if (!TIPOS_FATURA.includes(d.document_type?.saft_code ?? "")) return;
    const net = d.net_value ?? 0;
    const taxes = d.taxes_value ?? 0;
    total += net;
    semIva += net - taxes;
    iva += taxes;
    porPagar += net - (d.reconciled_value ?? 0);
    contagem += 1;
  }, { desde: dataInicio });

  return {
    data_inicio: dataInicio,
    data_fim: dataFim,
    total_faturado: arred(total),
    total_sem_iva: arred(semIva),
    total_iva: arred(iva),
    valor_por_pagar: arred(porPagar),
    numero_de_faturas: contagem,
    moeda: "EUR",
  };
}

// --------------------------- Vendas por cliente ---------------------------

export type VendasPorCliente = {
  periodo: string;
  total_geral: number;
  numero_de_clientes: number;
  numero_de_documentos: number;
  incompleto: boolean;
  base: string;
  ranking: Array<{ cliente: string; total: number; documentos: number }>;
};

export async function consultarVendasPorCliente(
  dataInicio?: string,
  dataFim?: string,
  topN = 25
): Promise<VendasPorCliente> {
  if (!isConnected()) throw new Error("NAO_LIGADO");

  const mapa = new Map<string, { total: number; documentos: number }>();
  let totalGeral = 0;
  let numDocs = 0;

  const incompleto = await percorrerDocumentos((d) => {
    if (!TIPOS_FATURA.includes(d.document_type?.saft_code ?? "")) return;
    const data = dia10(d.date);
    if (dataInicio && data < dataInicio) return;
    if (dataFim && data > dataFim) return;

    const nome = d.entity_name ? String(d.entity_name).trim() : "";
    const cliente = nome || "(sem cliente identificado)";
    const valor = d.net_value ?? 0;

    const atual = mapa.get(cliente) ?? { total: 0, documentos: 0 };
    atual.total += valor;
    atual.documentos += 1;
    mapa.set(cliente, atual);

    totalGeral += valor;
    numDocs += 1;
  }, { desde: dataInicio });

  const ranking = Array.from(mapa.entries())
    .map(([cliente, v]) => ({ cliente, total: arred(v.total), documentos: v.documentos }))
    .sort((x, y) => y.total - x.total)
    .slice(0, Math.min(Math.max(topN, 1), 100));

  return {
    periodo:
      dataInicio || dataFim ? `${dataInicio ?? "início"} a ${dataFim ?? "hoje"}` : "todo o histórico",
    total_geral: arred(totalGeral),
    numero_de_clientes: mapa.size,
    numero_de_documentos: numDocs,
    incompleto,
    base: "Inclui faturas (FT/FS/FR), total com IVA.",
    ranking,
  };
}

// --------------------------- KPIs do módulo de Gestão ---------------------------

function evolucao(serie: number[]): number | null {
  const ativos = serie.filter((v) => v > 0);
  if (ativos.length < 2) return null;
  const primeiro = ativos[0];
  const ultimo = ativos[ativos.length - 1];
  if (primeiro === 0) return null;
  return Math.round(((ultimo - primeiro) / primeiro) * 1000) / 10;
}

export async function consultarKpisGestao(ano: number) {
  const meses = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, receitas: 0, despesas: 0 }));

  if (!isConnected()) {
    return {
      ligado: false,
      ano,
      meses,
      total_receitas: 0,
      total_despesas: 0,
      evolucao_receitas: null,
      evolucao_despesas: null,
      liquidez_media: null,
    };
  }

  const inicio = `${ano}-01-01`;
  const fim = `${ano}-12-31`;

  // Receitas: faturas de venda (FT/FS/FR), total com IVA, por mês.
  // Nota: despesas (compras a fornecedores) ficam a 0 nesta fase — a validar
  // com o endpoint de documentos de fornecedor antes de as somar.
  await percorrerDocumentos((d) => {
    const data = dia10(d.date);
    if (data < inicio || data > fim) return;
    if (!TIPOS_FATURA.includes(d.document_type?.saft_code ?? "")) return;
    const m = Number(data.slice(5, 7));
    if (m >= 1 && m <= 12) meses[m - 1].receitas += d.net_value ?? 0;
  }, { desde: inicio });

  for (const m of meses) m.receitas = arred(m.receitas);

  const total_despesas = 0;
  return {
    ligado: true,
    ano,
    meses,
    total_receitas: arred(meses.reduce((s, m) => s + m.receitas, 0)),
    total_despesas,
    evolucao_receitas: evolucao(meses.map((m) => m.receitas)),
    evolucao_despesas: null,
    // Sem despesas ainda, a liquidez não é calculável de forma honesta.
    liquidez_media: null,
  };
}

// --------------------------- Consulta genérica (listagens) ---------------------------

export type ResultadoRecurso = {
  recurso: string;
  devolvidos: number;
  ha_mais: boolean;
  total_aproximado: number | null;
  registos: Array<Record<string, unknown>>;
};

export async function consultarDados(
  recurso: string,
  pesquisa?: string,
  limite = 20
): Promise<ResultadoRecurso> {
  if (!isConnected()) throw new Error("NAO_LIGADO");

  const endpoint = RECURSOS_MOLONI[recurso];
  if (!endpoint) throw new Error("RECURSO_INVALIDO");

  const companyId = await getCompanyId();
  if (!companyId) throw new Error("SEM_EMPRESA");

  const cap = Math.min(Math.max(limite, 1), 50);

  // Total aproximado via <recurso>/count (quando disponível).
  let totalAprox: number | null = null;
  try {
    const c = (await apiPost(`${endpoint}/count`, { company_id: companyId })) as
      | number
      | { count?: number };
    if (typeof c === "number") totalAprox = c;
    else if (c && typeof c.count === "number") totalAprox = c.count;
  } catch {
    totalAprox = null;
  }

  // Amostra (com pesquisa, filtra do lado do cliente sobre um lote maior).
  const qty = pesquisa && pesquisa.trim() ? 100 : cap;
  const lote = (await apiPost(`${endpoint}/getAll`, {
    company_id: companyId,
    offset: 0,
    qty,
  })) as Array<Record<string, unknown>> | Record<string, unknown>;

  const itens = Array.isArray(lote) ? lote : [];
  let registos = itens;

  if (pesquisa && pesquisa.trim()) {
    const termo = pesquisa.trim().toLowerCase();
    registos = itens.filter((it) =>
      Object.values(it).some((v) => v != null && String(v).toLowerCase().includes(termo))
    );
  }

  const haMais = registos.length > cap || (totalAprox !== null && totalAprox > cap);
  registos = registos.slice(0, cap);

  return {
    recurso,
    devolvidos: registos.length,
    ha_mais: haMais,
    total_aproximado: totalAprox,
    registos,
  };
}

// =====================================================================
// MÉTRICAS DE VENDAS (Fase A) — painel da Contabilidade
// Uma única passagem aos documentos (ano atual + anterior) calcula:
//  vendas YTD, objetivo, homólogo mensal, trimestres, concentração de
//  clientes (top 10) e vendas por comercial. Valores EX-IVA (volume de
//  negócios), líquidos de notas de crédito (devoluções).
// =====================================================================

const TIPOS_VENDA = ["FT", "FS", "FR"]; // somam
const TIPOS_CREDITO = ["NC"]; // subtraem (devoluções)

export type MetricasVendas = {
  ligado: boolean;
  ano: number;
  moeda: string;
  base: string;
  meta_ano: number | null;
  vendas_ytd: number;
  meta_percent: number | null;
  projecao_ano: number;
  meses_atual: number[];
  meses_anterior: number[];
  ytd_atual: number;
  ytd_homologo: number;
  var_homologa: number | null;
  trimestres_atual: number[];
  trimestres_anterior: number[];
  num_clientes: number;
  total_vendas_ano: number;
  concentracao_top10: number | null;
  top_clientes: Array<{ nome: string; total: number; pct: number }>;
  vendas_por_comercial: Array<{ nome: string; total: number; pct: number }>;
  incompleto: boolean;
};

async function nomesComerciais(companyId: number): Promise<Map<number, string>> {
  const mapa = new Map<number, string>();
  try {
    const lista = (await apiPost("salesmen/getAll", { company_id: companyId })) as Array<{
      salesman_id?: number;
      name?: string;
    }>;
    if (Array.isArray(lista)) {
      for (const s of lista) {
        if (s.salesman_id != null) mapa.set(s.salesman_id, (s.name ?? "").trim() || `Comercial ${s.salesman_id}`);
      }
    }
  } catch {
    /* fica vazio; usamos o id */
  }
  return mapa;
}

function metricasVazias(ano: number): MetricasVendas {
  return {
    ligado: false,
    ano,
    moeda: "EUR",
    base: "sem IVA",
    meta_ano: metaVendasAno(),
    vendas_ytd: 0,
    meta_percent: null,
    projecao_ano: 0,
    meses_atual: new Array(12).fill(0),
    meses_anterior: new Array(12).fill(0),
    ytd_atual: 0,
    ytd_homologo: 0,
    var_homologa: null,
    trimestres_atual: [0, 0, 0, 0],
    trimestres_anterior: [0, 0, 0, 0],
    num_clientes: 0,
    total_vendas_ano: 0,
    concentracao_top10: null,
    top_clientes: [],
    vendas_por_comercial: [],
    incompleto: false,
  };
}

export async function consultarMetricasVendas(ano: number): Promise<MetricasVendas> {
  if (!isConnected()) return metricasVazias(ano);

  const companyId = await getCompanyId();
  if (!companyId) throw new Error("SEM_EMPRESA");
  const nomesCom = await nomesComerciais(companyId);

  const anoAnterior = ano - 1;
  const desde = `${anoAnterior}-01-01`;

  const meses_atual = new Array(12).fill(0);
  const meses_anterior = new Array(12).fill(0);
  const clientes = new Map<string, number>();
  const comerciais = new Map<number, number>();

  const incompleto = await percorrerDocumentos(
    (d) => {
      const saft = d.document_type?.saft_code ?? "";
      let sinal = 0;
      if (TIPOS_VENDA.includes(saft)) sinal = 1;
      else if (TIPOS_CREDITO.includes(saft)) sinal = -1;
      else return;

      const dia = dia10(d.date);
      const anoDoc = dia.slice(0, 4);
      const mes = Number(dia.slice(5, 7));
      if (mes < 1 || mes > 12) return;

      const valor = ((d.net_value ?? 0) - (d.taxes_value ?? 0)) * sinal; // ex-IVA

      if (anoDoc === String(ano)) {
        meses_atual[mes - 1] += valor;
        const nome = (d.entity_name || "(sem cliente)").trim();
        clientes.set(nome, (clientes.get(nome) ?? 0) + valor);
        const sid = d.salesman_id ?? 0;
        comerciais.set(sid, (comerciais.get(sid) ?? 0) + valor);
      } else if (anoDoc === String(anoAnterior)) {
        meses_anterior[mes - 1] += valor;
      }
    },
    { desde }
  );

  const arrRound = (a: number[]) => a.map(arred);
  const trimestres = (a: number[]) => [0, 1, 2, 3].map((q) => arred(a[q * 3] + a[q * 3 + 1] + a[q * 3 + 2]));

  const ehAnoCorrente = new Date().getFullYear() === ano;
  const mesCorrente = ehAnoCorrente ? new Date().getMonth() + 1 : 12;

  const ytd_atual = arred(meses_atual.reduce((s, v) => s + v, 0));
  const ytd_homologo = arred(meses_anterior.slice(0, mesCorrente).reduce((s, v) => s + v, 0));
  const var_homologa = ytd_homologo > 0 ? Math.round(((ytd_atual - ytd_homologo) / ytd_homologo) * 1000) / 10 : null;

  // Projeção anual por dia do ano (run-rate).
  const hoje = new Date();
  const diasDecorridos = ehAnoCorrente
    ? Math.max(1, Math.ceil((hoje.getTime() - new Date(ano, 0, 1).getTime()) / 86400000))
    : 365;
  const projecao_ano = arred((ytd_atual / diasDecorridos) * 365);

  const meta = metaVendasAno();
  const meta_percent = meta ? Math.round((ytd_atual / meta) * 1000) / 10 : null;

  const total_vendas_ano = arred(Array.from(clientes.values()).reduce((s, v) => s + v, 0));

  const top_clientes = Array.from(clientes.entries())
    .map(([nome, total]) => ({ nome, total: arred(total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map((c) => ({ ...c, pct: total_vendas_ano > 0 ? Math.round((c.total / total_vendas_ano) * 1000) / 10 : 0 }));

  const somaTop10 = top_clientes.reduce((s, c) => s + c.total, 0);
  const concentracao_top10 = total_vendas_ano > 0 ? Math.round((somaTop10 / total_vendas_ano) * 1000) / 10 : null;

  const vendas_por_comercial = Array.from(comerciais.entries())
    .map(([sid, total]) => ({
      nome: nomesCom.get(sid) ?? (sid === 0 ? "Sem comercial" : `Comercial ${sid}`),
      total: arred(total),
    }))
    .filter((c) => c.total !== 0)
    .sort((a, b) => b.total - a.total)
    .map((c) => ({ ...c, pct: total_vendas_ano > 0 ? Math.round((c.total / total_vendas_ano) * 1000) / 10 : 0 }));

  return {
    ligado: true,
    ano,
    moeda: "EUR",
    base: "sem IVA",
    meta_ano: meta,
    vendas_ytd: ytd_atual,
    meta_percent,
    projecao_ano,
    meses_atual: arrRound(meses_atual),
    meses_anterior: arrRound(meses_anterior),
    ytd_atual,
    ytd_homologo,
    var_homologa,
    trimestres_atual: trimestres(meses_atual),
    trimestres_anterior: trimestres(meses_anterior),
    num_clientes: clientes.size,
    total_vendas_ano,
    concentracao_top10,
    top_clientes,
    vendas_por_comercial,
    incompleto,
  };
}
