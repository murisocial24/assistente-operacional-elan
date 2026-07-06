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
  expiration_date?: string;
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
// MÉTRICAS DA CONTABILIDADE (Fase A) — painel
// Uma única passagem aos documentos (ano atual + anterior) calcula:
//  vendas YTD, objetivo, homólogo mensal, trimestres, concentração de
//  clientes, vendas por comercial, aging, DSO e alerta de erosão.
//  + fichas de cliente (para novos clientes do mês).
// Vendas em EX-IVA (volume de negócios); aging/DSO em COM IVA (dívida real).
// =====================================================================

const TIPOS_VENDA = ["FT", "FS", "FR"]; // somam
const TIPOS_CREDITO = ["NC"]; // subtraem (devoluções)
const MESES_PT = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const pad2 = (n: number) => String(n).padStart(2, "0");

export type ItemComercial = { nome: string; total: number; pct: number };
export type LinhaAging = {
  nome: string;
  corrente: number;
  b1_30: number;
  b31_45: number;
  b46_60: number;
  b60_mais: number;
  vencido: number;
};
export type ClienteErosao = { nome: string; atual: number; homologo: number; queda: number; variacao_pct: number | null };

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
  top_clientes: ItemComercial[];
  vendas_por_comercial: ItemComercial[];
  aging: {
    total_vencido: number;
    corrente: number;
    b1_30: number;
    b31_45: number;
    b46_60: number;
    b60_mais: number;
    por_comercial: LinhaAging[];
  };
  dso: number | null;
  novos_clientes: {
    mes_label: string;
    total: number;
    metodo: string;
    por_comercial: Array<{ nome: string; novos: number }>;
  };
  erosao: {
    periodo_label: string;
    homologo_label: string;
    clientes: ClienteErosao[];
  };
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

type FichaCliente = { customer_id?: number; name?: string; salesman_id?: number; created?: string; date?: string; insert_date?: string };

async function fichasClientes(companyId: number): Promise<FichaCliente[]> {
  const todos: FichaCliente[] = [];
  let offset = 0;
  const qty = 250;
  try {
    while (true) {
      const lote = (await apiPost("customers/getAll", { company_id: companyId, offset, qty })) as FichaCliente[] | Record<string, unknown>;
      if (!Array.isArray(lote) || lote.length === 0) break;
      todos.push(...lote);
      offset += lote.length;
      if (offset >= 6000) break;
    }
  } catch {
    /* devolve o que tiver */
  }
  return todos;
}

function nomeComercial(nomesCom: Map<number, string>, sid?: number): string {
  if (sid == null || sid === 0) return "Sem comercial";
  return nomesCom.get(sid) ?? `Comercial ${sid}`;
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
    aging: { total_vencido: 0, corrente: 0, b1_30: 0, b31_45: 0, b46_60: 0, b60_mais: 0, por_comercial: [] },
    dso: null,
    novos_clientes: { mes_label: "", total: 0, metodo: "", por_comercial: [] },
    erosao: { periodo_label: "", homologo_label: "", clientes: [] },
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

  // Datas de referência
  const agora = new Date();
  const hojeStr = `${agora.getFullYear()}-${pad2(agora.getMonth() + 1)}-${pad2(agora.getDate())}`;
  const ehAnoCorrente = agora.getFullYear() === ano;
  const mesCorrente = ehAnoCorrente ? agora.getMonth() + 1 : 12;
  const limite365 = new Date(agora.getTime() - 365 * 86400000);
  const limite365Str = `${limite365.getFullYear()}-${pad2(limite365.getMonth() + 1)}-${pad2(limite365.getDate())}`;

  // Trimestre mais recente concluído (para a erosão)
  const triAtual = Math.floor(agora.getMonth() / 3);
  const triAlvo = triAtual > 0 ? triAtual - 1 : 3;
  const anoAlvo = triAtual > 0 ? ano : ano - 1;
  const mIni = triAlvo * 3 + 1;
  const mFim = triAlvo * 3 + 3;
  const eroAtualIni = `${anoAlvo}-${pad2(mIni)}-01`;
  const eroAtualFim = `${anoAlvo}-${pad2(mFim)}-31`;
  const eroHomoIni = `${anoAlvo - 1}-${pad2(mIni)}-01`;
  const eroHomoFim = `${anoAlvo - 1}-${pad2(mFim)}-31`;

  // Acumuladores
  const meses_atual = new Array(12).fill(0);
  const meses_anterior = new Array(12).fill(0);
  const clientes = new Map<string, number>();
  const comerciais = new Map<number, number>();
  const erosaoAtual = new Map<string, number>();
  const erosaoHomo = new Map<string, number>();
  const agingCom = new Map<number, { corrente: number; b1_30: number; b31_45: number; b46_60: number; b60_mais: number }>();
  const agingTot = { corrente: 0, b1_30: 0, b31_45: 0, b46_60: 0, b60_mais: 0 };
  const primeiroDoc = new Map<number, { dia: string; sid: number }>();
  let arTotal = 0;
  let vendas365 = 0;

  const bucketAging = (m: Map<number, { corrente: number; b1_30: number; b31_45: number; b46_60: number; b60_mais: number }>, sid: number) => {
    let x = m.get(sid);
    if (!x) {
      x = { corrente: 0, b1_30: 0, b31_45: 0, b46_60: 0, b60_mais: 0 };
      m.set(sid, x);
    }
    return x;
  };

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
      const nome = (d.entity_name || "(sem cliente)").trim();
      const sid = d.salesman_id ?? 0;

      // Vendas mensais / clientes / comerciais (ano corrente e anterior)
      if (anoDoc === String(ano)) {
        meses_atual[mes - 1] += valor;
        clientes.set(nome, (clientes.get(nome) ?? 0) + valor);
        comerciais.set(sid, (comerciais.get(sid) ?? 0) + valor);
      } else if (anoDoc === String(anoAnterior)) {
        meses_anterior[mes - 1] += valor;
      }

      // Erosão (trimestre alvo vs homólogo)
      if (dia >= eroAtualIni && dia <= eroAtualFim) erosaoAtual.set(nome, (erosaoAtual.get(nome) ?? 0) + valor);
      else if (dia >= eroHomoIni && dia <= eroHomoFim) erosaoHomo.set(nome, (erosaoHomo.get(nome) ?? 0) + valor);

      // Aging + DSO + primeira compra (só faturas de venda)
      if (sinal === 1) {
        const cid = d.customer_id ?? 0;
        if (cid) {
          const pd = primeiroDoc.get(cid);
          if (!pd || dia < pd.dia) primeiroDoc.set(cid, { dia, sid });
        }
        if (dia >= limite365Str) vendas365 += d.net_value ?? 0; // com IVA (últimos 365 dias)

        const emAberto = (d.net_value ?? 0) - (d.reconciled_value ?? 0); // com IVA
        if (emAberto > 0.01) {
          arTotal += emAberto;
          const exp = dia10(d.expiration_date) || dia;
          const diasAtraso = Math.floor((Date.parse(hojeStr) - Date.parse(exp)) / 86400000);
          const linha = bucketAging(agingCom, sid);
          let b: keyof typeof agingTot;
          if (diasAtraso <= 0) b = "corrente";
          else if (diasAtraso <= 30) b = "b1_30";
          else if (diasAtraso <= 45) b = "b31_45";
          else if (diasAtraso <= 60) b = "b46_60";
          else b = "b60_mais";
          agingTot[b] += emAberto;
          linha[b] += emAberto;
        }
      }
    },
    { desde }
  );

  // ---- Vendas / objetivo / homólogo / trimestres / concentração / comercial ----
  const arrRound = (a: number[]) => a.map(arred);
  const trimestres = (a: number[]) => [0, 1, 2, 3].map((q) => arred(a[q * 3] + a[q * 3 + 1] + a[q * 3 + 2]));

  const ytd_atual = arred(meses_atual.reduce((s, v) => s + v, 0));
  const ytd_homologo = arred(meses_anterior.slice(0, mesCorrente).reduce((s, v) => s + v, 0));
  const var_homologa = ytd_homologo > 0 ? Math.round(((ytd_atual - ytd_homologo) / ytd_homologo) * 1000) / 10 : null;

  const diasDecorridos = ehAnoCorrente ? Math.max(1, Math.ceil((agora.getTime() - new Date(ano, 0, 1).getTime()) / 86400000)) : 365;
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
    .map(([sid, total]) => ({ nome: nomeComercial(nomesCom, sid), total: arred(total) }))
    .filter((c) => c.total !== 0)
    .sort((a, b) => b.total - a.total)
    .map((c) => ({ ...c, pct: total_vendas_ano > 0 ? Math.round((c.total / total_vendas_ano) * 1000) / 10 : 0 }));

  // ---- Aging ----
  const por_comercial_aging: LinhaAging[] = Array.from(agingCom.entries())
    .map(([sid, x]) => ({
      nome: nomeComercial(nomesCom, sid),
      corrente: arred(x.corrente),
      b1_30: arred(x.b1_30),
      b31_45: arred(x.b31_45),
      b46_60: arred(x.b46_60),
      b60_mais: arred(x.b60_mais),
      vencido: arred(x.b1_30 + x.b31_45 + x.b46_60 + x.b60_mais),
    }))
    .filter((l) => l.vencido > 0 || l.corrente > 0)
    .sort((a, b) => b.vencido - a.vencido);
  const total_vencido = arred(agingTot.b1_30 + agingTot.b31_45 + agingTot.b46_60 + agingTot.b60_mais);

  // ---- DSO ----
  const dso = arTotal > 0 && vendas365 > 0 ? Math.round((arTotal / vendas365) * 365) : null;

  // ---- Novos clientes do mês ----
  const fichas = await fichasClientes(companyId);
  const mesAtualStr = `${ano}-${pad2(mesCorrente)}`;
  const campoData = (f: FichaCliente): string => dia10(f.created || f.date || f.insert_date || "");
  const temDataFicha = fichas.some((f) => campoData(f).length === 10);
  const novosPorCom = new Map<number, number>();
  let novosTotal = 0;
  let metodo: string;

  if (temDataFicha) {
    metodo = "data de criação da ficha";
    const salesmanPorCliente = new Map<number, number>();
    for (const f of fichas) if (f.customer_id != null) salesmanPorCliente.set(f.customer_id, f.salesman_id ?? 0);
    for (const f of fichas) {
      const dc = campoData(f);
      if (dc.slice(0, 7) !== mesAtualStr) continue;
      novosTotal += 1;
      let sid = f.salesman_id ?? 0;
      if (!sid && f.customer_id != null) sid = primeiroDoc.get(f.customer_id)?.sid ?? 0;
      novosPorCom.set(sid, (novosPorCom.get(sid) ?? 0) + 1);
    }
  } else {
    // Sem data de criação na ficha: usamos a 1.ª compra (nos dados disponíveis).
    metodo = "1.ª compra (a ficha não expõe data de criação)";
    for (const [, pd] of primeiroDoc) {
      if (pd.dia.slice(0, 7) !== mesAtualStr) continue;
      novosTotal += 1;
      novosPorCom.set(pd.sid, (novosPorCom.get(pd.sid) ?? 0) + 1);
    }
  }

  const novos_por_comercial = Array.from(novosPorCom.entries())
    .map(([sid, novos]) => ({ nome: nomeComercial(nomesCom, sid), novos }))
    .sort((a, b) => b.novos - a.novos);

  // ---- Erosão (trimestre alvo vs homólogo) ----
  const nomesErosao = new Set<string>([...erosaoAtual.keys(), ...erosaoHomo.keys()]);
  const clientesErosao: ClienteErosao[] = [];
  for (const nome of nomesErosao) {
    const homologo = arred(erosaoHomo.get(nome) ?? 0);
    const atual = arred(erosaoAtual.get(nome) ?? 0);
    if (homologo > 0 && atual < homologo) {
      clientesErosao.push({
        nome,
        atual,
        homologo,
        queda: arred(homologo - atual),
        variacao_pct: homologo > 0 ? Math.round(((atual - homologo) / homologo) * 1000) / 10 : null,
      });
    }
  }
  clientesErosao.sort((a, b) => b.queda - a.queda);

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
    aging: {
      total_vencido,
      corrente: arred(agingTot.corrente),
      b1_30: arred(agingTot.b1_30),
      b31_45: arred(agingTot.b31_45),
      b46_60: arred(agingTot.b46_60),
      b60_mais: arred(agingTot.b60_mais),
      por_comercial: por_comercial_aging,
    },
    dso,
    novos_clientes: {
      mes_label: `${MESES_PT[mesCorrente - 1]} de ${ano}`,
      total: novosTotal,
      metodo,
      por_comercial: novos_por_comercial,
    },
    erosao: {
      periodo_label: `T${triAlvo + 1} ${anoAlvo}`,
      homologo_label: `T${triAlvo + 1} ${anoAlvo - 1}`,
      clientes: clientesErosao.slice(0, 15),
    },
    incompleto,
  };
}

// =====================================================================
// CACHE DAS MÉTRICAS
// O painel percorre 2 anos de documentos + fichas de clientes — pesado.
// Guardamos o resultado (memória + disco persistente) e servimo-lo de
// imediato; quando fica "velho", devolvemos o que temos e recalculamos
// em segundo plano (stale-while-revalidate). Assim o painel abre rápido.
// TTL configurável em METRICAS_CACHE_TTL_MIN (por omissão 30 min).
// =====================================================================

type CacheMetricas = { ano: number; data: MetricasVendas; at: number };

let cacheMemoria: CacheMetricas | null = null;
let aRecalcular = false;
const TTL_MS = (Number(process.env.METRICAS_CACHE_TTL_MIN) || 30) * 60 * 1000;

function ficheiroCacheMetricas(): string | null {
  const dir = process.env.MOLONI_TOKEN_DIR; // reutiliza o disco persistente
  return dir ? `${dir}/metricas_cache.json` : null;
}

async function lerCacheDisco(): Promise<CacheMetricas | null> {
  const f = ficheiroCacheMetricas();
  if (!f) return null;
  try {
    const fs = await import("node:fs/promises");
    const txt = await fs.readFile(f, "utf8");
    return JSON.parse(txt) as CacheMetricas;
  } catch {
    return null;
  }
}

async function gravarCacheDisco(c: CacheMetricas): Promise<void> {
  const f = ficheiroCacheMetricas();
  if (!f) return;
  try {
    const fs = await import("node:fs/promises");
    await fs.writeFile(f, JSON.stringify(c), "utf8");
  } catch {
    /* silencioso */
  }
}

function recalcularEmFundo(ano: number): void {
  if (aRecalcular) return;
  aRecalcular = true;
  consultarMetricasVendas(ano)
    .then(async (d) => {
      cacheMemoria = { ano, data: d, at: Date.now() };
      await gravarCacheDisco(cacheMemoria);
    })
    .catch(() => {
      /* mantém o cache anterior */
    })
    .finally(() => {
      aRecalcular = false;
    });
}

export type MetricasComCache = { data: MetricasVendas; cache: string };

export async function metricasVendasComCache(ano: number, forcar = false): Promise<MetricasComCache> {
  if (!cacheMemoria) cacheMemoria = await lerCacheDisco();

  const temCacheAno = cacheMemoria && cacheMemoria.ano === ano;
  const fresco = temCacheAno && Date.now() - cacheMemoria!.at < TTL_MS;

  if (temCacheAno && fresco && !forcar) {
    return { data: cacheMemoria!.data, cache: "fresco" };
  }

  // Há cache (mesmo velho) e não foi forçado: devolve já e recalcula por trás.
  if (temCacheAno && !forcar) {
    recalcularEmFundo(ano);
    return { data: cacheMemoria!.data, cache: "a_atualizar" };
  }

  // 1.ª vez (sem cache) ou refresh forçado: calcula agora.
  const d = await consultarMetricasVendas(ano);
  cacheMemoria = { ano, data: d, at: Date.now() };
  await gravarCacheDisco(cacheMemoria);
  return { data: d, cache: forcar ? "forcado" : "primeiro" };
}

// =====================================================================
// DIAGNÓSTICO DE MARGEM (Fase B — validação antes de integrar)
// Calcula a margem real numa amostra de faturas, para confirmarmos:
//  - a regra do custo (produtos com vários fornecedores/custos)
//  - a correção do cálculo (venda ex-IVA - custo x qty)
//  - a cobertura (linhas/produtos sem custo)
//  - a performance (tempo por documento -> estimativa para o ano)
// =====================================================================

type MoloniFornecedor = { supplier_id?: number; cost_price?: number; cost_price_discounted?: number };
type MoloniProduto = {
  product_id?: number;
  reference?: string;
  name?: string;
  suppliers?: MoloniFornecedor[];
};
type InfoCusto = { custo: number; custos: number[]; ref: string; nome: string };
type LinhaDoc = { product_id?: number; reference?: string; name?: string; price?: number; qty?: number; discount?: number };

function custoPorRegra(custos: number[]): number {
  if (!custos.length) return 0;
  const regra = (process.env.MARGEM_REGRA_CUSTO || "ultimo").toLowerCase();
  if (regra === "alto") return Math.max(...custos);
  if (regra === "baixo") return Math.min(...custos);
  if (regra === "media") return custos.reduce((a, b) => a + b, 0) / custos.length;
  return custos[custos.length - 1]; // "ultimo" (omissão) — aproximação de "mais recente"
}

async function mapaCustos(companyId: number): Promise<Map<number, InfoCusto>> {
  const mapa = new Map<number, InfoCusto>();
  let offset = 0;
  const qty = 250;
  while (true) {
    const lote = (await apiPost("products/getAll", { company_id: companyId, offset, qty })) as
      | MoloniProduto[]
      | Record<string, unknown>;
    if (!Array.isArray(lote) || lote.length === 0) break;
    for (const p of lote) {
      if (p.product_id == null) continue;
      const custos = (p.suppliers ?? [])
        .map((s) => Number(s.cost_price ?? 0))
        .filter((c) => c > 0);
      const custo = custoPorRegra(custos);
      mapa.set(p.product_id, { custo, custos, ref: p.reference ?? "", nome: p.name ?? "" });
    }
    offset += lote.length;
    if (offset >= 20000) break;
  }
  return mapa;
}

export async function diagnosticoMargem(amostraDocs = 40): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const companyId = await getCompanyId();
  if (!companyId) throw new Error("SEM_EMPRESA");

  const custos = await mapaCustos(companyId);
  const nComCusto = Array.from(custos.values()).filter((c) => c.custo > 0).length;

  // Últimos documentos de venda (FT/FS/FR).
  const lote = (await apiPost("documents/getAll", { company_id: companyId, offset: 0, qty: amostraDocs * 2 })) as
    | MoloniDoc[]
    | Record<string, unknown>;
  const docs = Array.isArray(lote)
    ? lote.filter((d) => TIPOS_VENDA.includes(d.document_type?.saft_code ?? "")).slice(0, amostraDocs)
    : [];

  let vendaTotal = 0;
  let custoTotal = 0;
  let nLinhas = 0;
  let linhasSemCusto = 0;
  const exemplosLinha: Array<Record<string, unknown>> = [];

  const tLinhas0 = Date.now();
  for (const d of docs) {
    const docId = (d as { document_id?: number }).document_id;
    const det = (await apiPost("documents/getOne", { company_id: companyId, document_id: docId })) as {
      products?: LinhaDoc[];
    };
    for (const l of det.products ?? []) {
      const qtd = Number(l.qty ?? 0);
      const precoUnit = Number(l.price ?? 0);
      const desc = Number(l.discount ?? 0);
      const vendaLinha = precoUnit * qtd * (1 - desc / 100); // ex-IVA, líquido de desconto de linha
      const info = l.product_id != null ? custos.get(l.product_id) : undefined;
      const custoUnit = info?.custo ?? 0;
      const custoLinha = custoUnit * qtd;
      if (!info || custoUnit === 0) linhasSemCusto += 1;
      vendaTotal += vendaLinha;
      custoTotal += custoLinha;
      nLinhas += 1;
      if (exemplosLinha.length < 8) {
        exemplosLinha.push({
          ref: l.reference,
          nome: l.name,
          qtd,
          preco_unit: precoUnit,
          desconto_pct: desc,
          venda_linha: arred(vendaLinha),
          custo_unit: custoUnit,
          custo_linha: arred(custoLinha),
          margem_linha: arred(vendaLinha - custoLinha),
        });
      }
    }
  }
  const tempoLinhasMs = Date.now() - tLinhas0;
  const margemTotal = arred(vendaTotal - custoTotal);
  const margemPct = vendaTotal > 0 ? Math.round((margemTotal / vendaTotal) * 1000) / 10 : null;
  const tempoPorDoc = docs.length ? tempoLinhasMs / docs.length : 0;

  const multiFornecedor = Array.from(custos.values())
    .filter((c) => c.custos.length > 1)
    .slice(0, 10)
    .map((c) => ({ ref: c.ref, nome: c.nome, custos: c.custos, custo_escolhido: c.custo }));

  return {
    nota: "Diagnóstico de margem (amostra). Confirmar a regra do custo antes de integrar no painel.",
    regra_custo: "custo do ÚLTIMO fornecedor listado no produto (aproximação de 'mais recente')",
    amostra_documentos: docs.length,
    n_linhas: nLinhas,
    linhas_sem_custo: linhasSemCusto,
    venda_total_amostra: arred(vendaTotal),
    custo_total_amostra: arred(custoTotal),
    margem_total_amostra: margemTotal,
    margem_pct: margemPct,
    produtos_total: custos.size,
    produtos_com_custo: nComCusto,
    produtos_multi_fornecedor: multiFornecedor,
    exemplos_linha: exemplosLinha,
    performance: {
      tempo_total_ms: Date.now() - t0,
      tempo_por_documento_ms: Math.round(tempoPorDoc),
      estimativa_para_1000_docs_seg: Math.round((tempoPorDoc * 1000) / 1000),
    },
  };
}

// =====================================================================
// MARGEM — cálculo completo do ano (Fase B) + cache em segundo plano
// Percorre as faturas de venda do ano, lê as linhas de cada uma e cruza
// com o custo do produto. Pesado (~1 chamada por fatura) -> corre em
// segundo plano e o resultado fica em cache (memória + disco).
//   - Venda EX-IVA, líquida de desconto de linha.
//   - Linhas sem custo: excluídas da margem (contabilizadas à parte).
//   - Ofertas (100% desconto): incluídas (venda 0, custo real).
// =====================================================================

export type MargemItem = { nome: string; venda: number; custo: number; margem: number; margem_pct: number | null };
export type MargemMes = { mes: number; venda: number; custo: number; margem: number; margem_pct: number | null };
export type ResultadoMargem = {
  ligado: boolean;
  ano: number;
  base: string;
  regra_custo: string;
  venda_total: number;
  custo_total: number;
  margem_total: number;
  margem_pct: number | null;
  venda_sem_custo: number;
  meses: MargemMes[];
  por_cliente: MargemItem[];
  por_referencia: MargemItem[];
  n_documentos: number;
  incompleto: boolean;
  calculado_em: number;
};

const pctMargem = (v: number, c: number): number | null =>
  v > 0 ? Math.round(((v - c) / v) * 1000) / 10 : null;

export async function calcularMargem(ano: number): Promise<ResultadoMargem> {
  const companyId = await getCompanyId();
  if (!companyId) throw new Error("SEM_EMPRESA");
  const custos = await mapaCustos(companyId);

  const desde = `${ano}-01-01`;
  const meses = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, venda: 0, custo: 0 }));
  const cli = new Map<string, { venda: number; custo: number }>();
  const ref = new Map<string, { venda: number; custo: number; nome: string }>();
  let vendaTotal = 0;
  let custoTotal = 0;
  let vendaSemCusto = 0;
  let nDocs = 0;
  let incompleto = false;

  let offset = 0;
  const qty = 200;
  while (true) {
    const lote = (await apiPost("documents/getAll", { company_id: companyId, offset, qty })) as
      | MoloniDoc[]
      | Record<string, unknown>;
    if (!Array.isArray(lote) || lote.length === 0) break;

    let algumDoAno = false;
    for (const d of lote) {
      const dia = dia10(d.date);
      if (dia < desde) continue; // ano anterior — ignora (docs vêm por data desc)
      algumDoAno = true;
      if (!TIPOS_VENDA.includes(d.document_type?.saft_code ?? "")) continue;

      const mes = Number(dia.slice(5, 7));
      const nomeCli = (d.entity_name || "(sem cliente)").trim();
      const docId = (d as { document_id?: number }).document_id;
      const det = (await apiPost("documents/getOne", { company_id: companyId, document_id: docId })) as {
        products?: LinhaDoc[];
      };
      nDocs += 1;

      for (const l of det.products ?? []) {
        const qtd = Number(l.qty ?? 0);
        const precoUnit = Number(l.price ?? 0);
        const desc = Number(l.discount ?? 0);
        const venda = precoUnit * qtd * (1 - desc / 100);
        const info = l.product_id != null ? custos.get(l.product_id) : undefined;
        const custoUnit = info?.custo ?? 0;

        if (!info || custoUnit === 0) {
          vendaSemCusto += venda; // sem custo -> fora da margem
          continue;
        }
        const custo = custoUnit * qtd;
        vendaTotal += venda;
        custoTotal += custo;
        if (mes >= 1 && mes <= 12) {
          meses[mes - 1].venda += venda;
          meses[mes - 1].custo += custo;
        }
        const c = cli.get(nomeCli) ?? { venda: 0, custo: 0 };
        c.venda += venda;
        c.custo += custo;
        cli.set(nomeCli, c);

        const refKey = (l.reference || l.name || "(s/ ref)").toString().trim();
        const r = ref.get(refKey) ?? { venda: 0, custo: 0, nome: (l.name ?? "").toString().trim() };
        r.venda += venda;
        r.custo += custo;
        ref.set(refKey, r);
      }
    }

    offset += lote.length;
    if (!algumDoAno) break; // página inteira já é de anos anteriores
    if (offset >= 12000) {
      incompleto = true;
      break;
    }
  }

  const mesesOut: MargemMes[] = meses.map((m) => ({
    mes: m.mes,
    venda: arred(m.venda),
    custo: arred(m.custo),
    margem: arred(m.venda - m.custo),
    margem_pct: pctMargem(m.venda, m.custo),
  }));
  const porCliente: MargemItem[] = Array.from(cli.entries())
    .map(([nome, v]) => ({ nome, venda: arred(v.venda), custo: arred(v.custo), margem: arred(v.venda - v.custo), margem_pct: pctMargem(v.venda, v.custo) }))
    .sort((a, b) => b.venda - a.venda)
    .slice(0, 20);
  const porRef: MargemItem[] = Array.from(ref.entries())
    .map(([k, v]) => ({ nome: v.nome ? `${k} — ${v.nome}` : k, venda: arred(v.venda), custo: arred(v.custo), margem: arred(v.venda - v.custo), margem_pct: pctMargem(v.venda, v.custo) }))
    .sort((a, b) => b.venda - a.venda)
    .slice(0, 20);

  return {
    ligado: true,
    ano,
    base: "sem IVA",
    regra_custo: (process.env.MARGEM_REGRA_CUSTO || "ultimo").toLowerCase(),
    venda_total: arred(vendaTotal),
    custo_total: arred(custoTotal),
    margem_total: arred(vendaTotal - custoTotal),
    margem_pct: pctMargem(vendaTotal, custoTotal),
    venda_sem_custo: arred(vendaSemCusto),
    meses: mesesOut,
    por_cliente: porCliente,
    por_referencia: porRef,
    n_documentos: nDocs,
    incompleto,
    calculado_em: Date.now(),
  };
}

// ---- Cache + cálculo em segundo plano ----
type CacheMargem = { ano: number; data: ResultadoMargem; at: number };
let cacheMargem: CacheMargem | null = null;
let margemACalcular = false;
const TTL_MARGEM_MS = (Number(process.env.MARGEM_CACHE_TTL_H) || 6) * 3600 * 1000;

function ficheiroMargem(): string | null {
  const d = process.env.MOLONI_TOKEN_DIR;
  return d ? `${d}/margem_cache.json` : null;
}
async function lerMargemDisco(): Promise<CacheMargem | null> {
  const f = ficheiroMargem();
  if (!f) return null;
  try {
    const fs = await import("node:fs/promises");
    return JSON.parse(await fs.readFile(f, "utf8")) as CacheMargem;
  } catch {
    return null;
  }
}
async function gravarMargemDisco(c: CacheMargem): Promise<void> {
  const f = ficheiroMargem();
  if (!f) return;
  try {
    const fs = await import("node:fs/promises");
    await fs.writeFile(f, JSON.stringify(c), "utf8");
  } catch {
    /* silencioso */
  }
}
function iniciarCalculoMargem(ano: number): void {
  if (margemACalcular) return;
  margemACalcular = true;
  calcularMargem(ano)
    .then(async (d) => {
      cacheMargem = { ano, data: d, at: Date.now() };
      await gravarMargemDisco(cacheMargem);
    })
    .catch(() => {})
    .finally(() => {
      margemACalcular = false;
    });
}

export type MargemEstado = { estado: "pronto" | "a_atualizar" | "a_calcular"; data: ResultadoMargem | null };

export async function margemComEstado(ano: number, forcar = false): Promise<MargemEstado> {
  if (!cacheMargem) cacheMargem = await lerMargemDisco();
  const temAno = cacheMargem && cacheMargem.ano === ano;
  const fresco = temAno && Date.now() - cacheMargem!.at < TTL_MARGEM_MS;

  if (temAno && fresco && !forcar) return { estado: "pronto", data: cacheMargem!.data };

  iniciarCalculoMargem(ano);
  if (temAno && !forcar) return { estado: "a_atualizar", data: cacheMargem!.data };
  return { estado: "a_calcular", data: temAno ? cacheMargem!.data : null };
}
