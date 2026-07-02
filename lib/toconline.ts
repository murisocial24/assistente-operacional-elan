// =====================================================================
// CONECTOR TOC ONLINE
// ---------------------------------------------------------------------
// Gere a autenticação OAuth2 e vai buscar dados reais ao TOC Online:
//  - consultarFaturacao(): resumo agregado de faturação (totais, IVA, por pagar)
//  - consultarRecurso(): listagem/contagem genérica de áreas comuns
//    (clientes, fornecedores, compras, produtos, etc.)
//
// Autenticação: pelo botão "Ligar TOC Online" (fluxo OAuth) ou por variáveis
// de ambiente. Ver README.
// =====================================================================

const API_BASE = process.env.TOCONLINE_API_BASE ?? "";

let accessToken = process.env.TOCONLINE_ACCESS_TOKEN ?? "";
let refreshToken = process.env.TOCONLINE_REFRESH_TOKEN ?? "";

const TIPOS_FATURA_PADRAO = ["FT", "FS", "FR"]; // Fatura, Fatura Simplificada, Fatura-Recibo

// Áreas de leitura disponíveis para a ferramenta genérica (todas GET / só leitura).
export const RECURSOS: Record<string, string> = {
  clientes: "/api/customers",
  fornecedores: "/api/suppliers",
  contactos: "/api/contacts",
  produtos: "/api/products",
  servicos: "/api/services",
  familias_artigos: "/api/item_families",
  vendas: "/api/commercial_sales_documents",
  recibos_venda: "/api/commercial_sales_receipts",
  compras: "/api/commercial_purchases_documents",
  pagamentos_compras: "/api/commercial_purchases_payments",
  categorias_despesa: "/api/expense_categories",
  contas_bancarias: "/api/bank_accounts",
  contas_caixa: "/api/cash_accounts",
};

export function getOAuthConfig() {
  return {
    oauthBase: process.env.TOCONLINE_OAUTH_BASE ?? "",
    clientId: process.env.TOCONLINE_CLIENT_ID ?? "",
    clientSecret: process.env.TOCONLINE_CLIENT_SECRET ?? "",
  };
}

export function setTokens(access?: string, refresh?: string): void {
  if (access) accessToken = access;
  if (refresh) refreshToken = refresh;
}

export function isConnected(): boolean {
  return Boolean(API_BASE && (accessToken || refreshToken));
}

type JsonApiItem = { id: string; type: string; attributes?: Record<string, unknown> };
type JsonApiResponse = { data?: JsonApiItem[]; meta?: Record<string, unknown> };

async function tentarRenovarToken(): Promise<boolean> {
  const { oauthBase, clientId, clientSecret } = getOAuthConfig();
  if (!oauthBase || !clientId || !clientSecret || !refreshToken) return false;

  const res = await fetch(`${oauthBase}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      scope: "commercial",
    }),
  });

  if (!res.ok) return false;
  const data = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!data.access_token) return false;

  accessToken = data.access_token;
  if (data.refresh_token) refreshToken = data.refresh_token;
  return true;
}

async function apiGet(path: string): Promise<JsonApiResponse> {
  if (!accessToken && refreshToken) await tentarRenovarToken();

  const fazer = () =>
    fetch(`${API_BASE}${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
    });

  let res = await fazer();
  if (res.status === 401 && (await tentarRenovarToken())) res = await fazer();

  if (res.status === 401) throw new Error("TOKEN_EXPIRADO");
  if (!res.ok) throw new Error(`Erro da API TOC Online (${res.status}).`);
  return (await res.json()) as JsonApiResponse;
}

// --------------------------- Faturação (agregado) ---------------------------

type SalesDocAttributes = {
  date?: string;
  document_type?: string;
  gross_total?: number;
  net_total?: number;
  tax_payable?: number;
  pending_total?: number;
  customer_business_name?: string;
};

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
  dataFim: string,
  tipos: string[] = TIPOS_FATURA_PADRAO
): Promise<ResumoFaturacao> {
  if (!isConnected()) throw new Error("NAO_LIGADO");

  const tamanhoPagina = 200;
  const maxPaginas = 25;
  let pagina = 1;
  let total = 0, semIva = 0, iva = 0, porPagar = 0, contagem = 0;

  while (pagina <= maxPaginas) {
    const json = await apiGet(
      `/api/commercial_sales_documents?page[number]=${pagina}&page[size]=${tamanhoPagina}`
    );
    const docs = json.data ?? [];
    if (docs.length === 0) break;

    for (const doc of docs) {
      const a = (doc.attributes ?? {}) as SalesDocAttributes;
      const data = a.date ?? "";
      if (data >= dataInicio && data <= dataFim && tipos.includes(a.document_type ?? "")) {
        total += a.gross_total ?? 0;
        semIva += a.net_total ?? 0;
        iva += a.tax_payable ?? 0;
        porPagar += a.pending_total ?? 0;
        contagem += 1;
      }
    }

    if (docs.length < tamanhoPagina) break;
    pagina += 1;
  }

  const arred = (n: number) => Math.round(n * 100) / 100;
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

// --------------------------- Consulta genérica ---------------------------

export type ResultadoRecurso = {
  recurso: string;
  devolvidos: number;
  ha_mais: boolean;
  total_aproximado: number | null;
  registos: Array<Record<string, unknown>>;
};

export async function consultarRecurso(
  recurso: string,
  pesquisa?: string,
  limite = 20
): Promise<ResultadoRecurso> {
  if (!isConnected()) throw new Error("NAO_LIGADO");

  const path = RECURSOS[recurso];
  if (!path) throw new Error("RECURSO_INVALIDO");

  const cap = Math.min(Math.max(limite, 1), 50);
  const registos: Array<Record<string, unknown>> = [];
  let haMais = false;
  let totalAprox: number | null = null;

  if (pesquisa && pesquisa.trim()) {
    const termo = pesquisa.trim().toLowerCase();
    const tamPag = 100;
    const maxPag = 5;
    for (let p = 1; p <= maxPag; p++) {
      const json = await apiGet(`${path}?page[number]=${p}&page[size]=${tamPag}`);
      const itens = json.data ?? [];
      if (itens.length === 0) break;
      for (const it of itens) {
        const attrs = it.attributes ?? {};
        const match = Object.values(attrs).some(
          (v) => v != null && String(v).toLowerCase().includes(termo)
        );
        if (match) {
          registos.push({ id: it.id, ...attrs });
          if (registos.length >= cap) break;
        }
      }
      if (registos.length >= cap) {
        haMais = true;
        break;
      }
      if (itens.length < tamPag) break;
    }
  } else {
    const json = await apiGet(`${path}?page[number]=1&page[size]=${cap}`);
    const itens = json.data ?? [];
    for (const it of itens) registos.push({ id: it.id, ...(it.attributes ?? {}) });
    haMais = itens.length >= cap;
    const meta = json.meta;
    if (meta) {
      const t = meta.total ?? meta.record_count ?? meta.total_count;
      if (typeof t === "number") totalAprox = t;
    }
  }

  return {
    recurso,
    devolvidos: registos.length,
    ha_mais: haMais,
    total_aproximado: totalAprox,
    registos,
  };
}

// Diagnóstico: devolve a resposta crua de um caminho da API (uso interno,
// apenas pela rota de debug). Ajuda a ver os nomes e tipos reais dos campos.
export async function consultaBruta(path: string): Promise<JsonApiResponse> {
  if (!isConnected()) throw new Error("NAO_LIGADO");
  return apiGet(path);
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

// Percorre TODOS os documentos de venda (paginação completa), agrupa por cliente
// e soma o total com IVA. Opcionalmente filtra por intervalo de datas (YYYY-MM-DD).
export async function consultarVendasPorCliente(
  dataInicio?: string,
  dataFim?: string,
  topN = 25
): Promise<VendasPorCliente> {
  if (!isConnected()) throw new Error("NAO_LIGADO");

  const tamanhoPagina = 200;
  const maxPaginas = 60; // salvaguarda: até 12.000 documentos
  let pagina = 1;
  let incompleto = false;

  const mapa = new Map<string, { total: number; documentos: number }>();
  let totalGeral = 0;
  let numDocs = 0;

  while (true) {
    if (pagina > maxPaginas) {
      incompleto = true;
      break;
    }
    const json = await apiGet(
      `/api/commercial_sales_documents?page[number]=${pagina}&page[size]=${tamanhoPagina}`
    );
    const docs = json.data ?? [];
    if (docs.length === 0) break;

    for (const doc of docs) {
      const a = (doc.attributes ?? {}) as SalesDocAttributes;
      const data = a.date ?? "";
      if (dataInicio && data < dataInicio) continue;
      if (dataFim && data > dataFim) continue;

      const nome = a.customer_business_name ? String(a.customer_business_name).trim() : "";
      const cliente = nome || "(sem cliente identificado)";
      const valor = a.gross_total ?? 0;

      const atual = mapa.get(cliente) ?? { total: 0, documentos: 0 };
      atual.total += valor;
      atual.documentos += 1;
      mapa.set(cliente, atual);

      totalGeral += valor;
      numDocs += 1;
    }

    if (docs.length < tamanhoPagina) break;
    pagina += 1;
  }

  const arred = (n: number) => Math.round(n * 100) / 100;
  const ranking = Array.from(mapa.entries())
    .map(([cliente, v]) => ({ cliente, total: arred(v.total), documentos: v.documentos }))
    .sort((x, y) => y.total - x.total)
    .slice(0, Math.min(Math.max(topN, 1), 100));

  return {
    periodo:
      dataInicio || dataFim
        ? `${dataInicio ?? "início"} a ${dataFim ?? "hoje"}`
        : "todo o histórico",
    total_geral: arred(totalGeral),
    numero_de_clientes: mapa.size,
    numero_de_documentos: numDocs,
    incompleto,
    base: "Inclui todos os documentos de venda, total com IVA.",
    ranking,
  };
}

// --------------------------- KPIs do módulo de Gestão ---------------------------

async function percorrerDocumentos(
  path: string,
  cb: (a: SalesDocAttributes) => void,
  maxPaginas = 60
): Promise<void> {
  const tam = 200;
  let p = 1;
  while (p <= maxPaginas) {
    const json = await apiGet(`${path}?page[number]=${p}&page[size]=${tam}`);
    const docs = json.data ?? [];
    if (docs.length === 0) break;
    for (const d of docs) cb((d.attributes ?? {}) as SalesDocAttributes);
    if (docs.length < tam) break;
    p++;
  }
}

export type KpisGestao = {
  ligado: boolean;
  ano: number;
  meses: Array<{ mes: number; receitas: number; despesas: number }>;
  total_receitas: number;
  total_despesas: number;
  evolucao_receitas: number | null;
  evolucao_despesas: number | null;
  liquidez_media: number | null;
};

function evolucao(serie: number[]): number | null {
  const ativos = serie.filter((v) => v > 0);
  if (ativos.length < 2) return null;
  const primeiro = ativos[0];
  const ultimo = ativos[ativos.length - 1];
  if (primeiro === 0) return null;
  return Math.round(((ultimo - primeiro) / primeiro) * 1000) / 10;
}

export async function consultarKpisGestao(ano: number): Promise<KpisGestao> {
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

  // Receitas: documentos de venda (com IVA, para coincidir com a faturação).
  await percorrerDocumentos("/api/commercial_sales_documents", (a) => {
    const d = a.date ?? "";
    if (d < inicio || d > fim) return;
    if (!["FT", "FS", "FR"].includes(a.document_type ?? "")) return;
    const m = Number(d.slice(5, 7));
    if (m >= 1 && m <= 12) meses[m - 1].receitas += a.gross_total ?? 0;
  });

  // Despesas: documentos de compra (campos assumidos — a validar pelo diagnóstico).
  await percorrerDocumentos("/api/commercial_purchases_documents", (a) => {
    const d = a.date ?? "";
    if (d < inicio || d > fim) return;
    const m = Number(d.slice(5, 7));
    if (m >= 1 && m <= 12) meses[m - 1].despesas += a.gross_total ?? 0;
  });

  const arred = (n: number) => Math.round(n * 100) / 100;
  for (const m of meses) {
    m.receitas = arred(m.receitas);
    m.despesas = arred(m.despesas);
  }

  // Liquidez média mensal: média de (receitas - despesas) / receitas nos meses com receita.
  let somaLiq = 0;
  let nLiq = 0;
  for (const m of meses) {
    if (m.receitas > 0) {
      somaLiq += (m.receitas - m.despesas) / m.receitas;
      nLiq += 1;
    }
  }

  return {
    ligado: true,
    ano,
    meses,
    total_receitas: arred(meses.reduce((s, m) => s + m.receitas, 0)),
    total_despesas: arred(meses.reduce((s, m) => s + m.despesas, 0)),
    evolucao_receitas: evolucao(meses.map((m) => m.receitas)),
    evolucao_despesas: evolucao(meses.map((m) => m.despesas)),
    liquidez_media: nLiq ? Math.round((somaLiq / nLiq) * 1000) / 10 : null,
  };
}
