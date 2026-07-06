// =====================================================================
// Conector ao Zoho CRM (região europeia por omissão).
// OAuth 2.0 (authorization code), leitura apenas. Tokens via variáveis de
// ambiente; o access token é renovado automaticamente com o refresh token.
// =====================================================================

const ACCOUNTS = process.env.ZOHO_ACCOUNTS_BASE || "https://accounts.zoho.eu";
const API = process.env.ZOHO_API_BASE || "https://www.zohoapis.eu";
const CLIENT_ID = process.env.ZOHO_CLIENT_ID || "";
const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || "";
const REDIRECT = process.env.ZOHO_REDIRECT_URI || "";
let REFRESH = process.env.ZOHO_REFRESH_TOKEN || "";

// Scopes de LEITURA apenas (least privilege).
export const ZOHO_SCOPES = [
  "ZohoCRM.modules.deals.READ",
  "ZohoCRM.modules.leads.READ",
  "ZohoCRM.modules.contacts.READ",
  "ZohoCRM.modules.accounts.READ",
  "ZohoCRM.modules.tasks.READ",
  "ZohoCRM.settings.READ",
].join(",");

let accessToken = "";
let accessExpira = 0;

type ZohoResp = {
  data?: Array<Record<string, unknown>>;
  info?: { more_records?: boolean; count?: number; page?: number };
};
type TokenResp = { access_token?: string; refresh_token?: string; error?: string };

export function isConnected(): boolean {
  return Boolean(REFRESH && CLIENT_ID && CLIENT_SECRET);
}

export function authUrl(): string {
  const p = new URLSearchParams({
    scope: ZOHO_SCOPES,
    client_id: CLIENT_ID,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    redirect_uri: REDIRECT,
  });
  return `${ACCOUNTS}/oauth/v2/auth?${p.toString()}`;
}

export async function trocarCodigo(code: string): Promise<TokenResp> {
  const p = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT,
    code,
  });
  const r = await fetch(`${ACCOUNTS}/oauth/v2/token?${p.toString()}`, { method: "POST" });
  const j = (await r.json()) as TokenResp;
  if (j.refresh_token) REFRESH = j.refresh_token;
  if (j.access_token) {
    accessToken = j.access_token;
    accessExpira = Date.now() + 3000 * 1000;
  }
  return j;
}

async function renovar(): Promise<void> {
  if (!REFRESH) throw new Error("NAO_LIGADO");
  const p = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH,
  });
  const r = await fetch(`${ACCOUNTS}/oauth/v2/token?${p.toString()}`, { method: "POST" });
  const j = (await r.json()) as TokenResp;
  if (!j.access_token) throw new Error("TOKEN_EXPIRADO");
  accessToken = j.access_token;
  accessExpira = Date.now() + 3000 * 1000;
}

async function apiGet(path: string): Promise<ZohoResp> {
  if (!isConnected()) throw new Error("NAO_LIGADO");
  if (!accessToken || Date.now() > accessExpira) await renovar();

  const fazer = () =>
    fetch(`${API}${path}`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });

  let r = await fazer();
  if (r.status === 401) {
    await renovar();
    r = await fazer();
  }
  if (r.status === 204) return { data: [] }; // sem registos
  if (!r.ok) throw new Error(`Zoho API ${r.status}`);
  return (await r.json()) as ZohoResp;
}

// --------------------------- Recursos do CRM ---------------------------

export const RECURSOS_CRM: Record<string, { api: string; nome: string; campos: string[] }> = {
  negocios: {
    api: "Deals",
    nome: "negócios (pipeline)",
    campos: ["Deal_Name", "Stage", "Amount", "Closing_Date", "Account_Name", "Pipeline", "Probability", "Created_Time"],
  },
  leads: {
    api: "Leads",
    nome: "leads",
    campos: ["Last_Name", "Company", "Lead_Source", "Lead_Status", "Email", "Converted__s", "Created_Time"],
  },
  contactos: {
    api: "Contacts",
    nome: "contactos",
    campos: ["Last_Name", "First_Name", "Account_Name", "Email", "Phone"],
  },
  empresas: {
    api: "Accounts",
    nome: "empresas/contas",
    campos: ["Account_Name", "Phone", "Website", "Industry"],
  },
  tarefas: {
    api: "Tasks",
    nome: "tarefas/atividades",
    campos: ["Subject", "Status", "Due_Date", "Priority", "Created_Time"],
  },
};

export async function consultarCrm(recurso: string, limite = 20) {
  const r = RECURSOS_CRM[recurso];
  if (!r) return { erro: `Recurso desconhecido. Disponíveis: ${Object.keys(RECURSOS_CRM).join(", ")}.` };
  if (!isConnected()) throw new Error("NAO_LIGADO");

  const todos: Array<Record<string, unknown>> = [];
  const tam = 200;
  const maxPaginas = 10;
  let page = 1;
  let haMais = false;

  while (page <= maxPaginas) {
    const j = await apiGet(`/crm/v8/${r.api}?fields=${r.campos.join(",")}&page=${page}&per_page=${tam}`);
    const data = j.data ?? [];
    todos.push(...data);
    if (!j.info?.more_records) {
      haMais = false;
      break;
    }
    haMais = true;
    page += 1;
  }

  return {
    recurso: r.nome,
    total_contado: todos.length,
    ha_mais: haMais,
    amostra: todos.slice(0, limite),
  };
}

export async function consultarPipeline() {
  if (!isConnected()) throw new Error("NAO_LIGADO");

  const tam = 200;
  const maxPaginas = 15;
  let page = 1;

  const fases = new Map<string, { negocios: number; valor: number }>();
  let ganhos = 0;
  let perdidos = 0;
  let abertos = 0;
  let valorAberto = 0;
  let valorGanho = 0;

  while (page <= maxPaginas) {
    const j = await apiGet(`/crm/v8/Deals?fields=Deal_Name,Stage,Amount&page=${page}&per_page=${tam}`);
    const data = j.data ?? [];
    for (const d of data) {
      const fase = (d.Stage as string) || "(sem fase)";
      const valor = Number(d.Amount ?? 0) || 0;
      const cur = fases.get(fase) ?? { negocios: 0, valor: 0 };
      cur.negocios += 1;
      cur.valor += valor;
      fases.set(fase, cur);

      const s = fase.toLowerCase();
      if (s.includes("won") || s.includes("ganho")) {
        ganhos += 1;
        valorGanho += valor;
      } else if (s.includes("lost") || s.includes("perdid")) {
        perdidos += 1;
      } else {
        abertos += 1;
        valorAberto += valor;
      }
    }
    if (!j.info?.more_records) break;
    page += 1;
  }

  const arred = (n: number) => Math.round(n * 100) / 100;
  const taxa = ganhos + perdidos > 0 ? Math.round((ganhos / (ganhos + perdidos)) * 1000) / 10 : null;

  return {
    fases: Array.from(fases.entries())
      .map(([fase, v]) => ({ fase, negocios: v.negocios, valor: arred(v.valor) }))
      .sort((a, b) => b.valor - a.valor),
    ganhos,
    perdidos,
    abertos,
    valor_em_aberto: arred(valorAberto),
    valor_ganho: arred(valorGanho),
    taxa_conversao_percent: taxa,
  };
}

// --------------------------- KPIs do módulo Comercial ---------------------------

export type KpisComercial = {
  ligado: boolean;
  ano: number;
  mes: number;
  vendas_mes: number;
  vendas_ano: number;
  ytd_atual: number;
  ytd_homologo: number;
  evolucao_homologa: number | null;
  meses: Array<{ mes: number; valor: number }>;
  melhor_comercial_mes: { nome: string; valor: number } | null;
  top_comerciais_ano: Array<{ nome: string; valor: number }>;
  top_clientes_ano: Array<{ nome: string; valor: number }>;
};

export async function consultarKpisComercial(): Promise<KpisComercial> {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = agora.getMonth() + 1;
  const meses = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, valor: 0 }));

  const vazio: KpisComercial = {
    ligado: false,
    ano,
    mes,
    vendas_mes: 0,
    vendas_ano: 0,
    ytd_atual: 0,
    ytd_homologo: 0,
    evolucao_homologa: null,
    meses,
    melhor_comercial_mes: null,
    top_comerciais_ano: [],
    top_clientes_ano: [],
  };
  if (!isConnected()) return vazio;

  const comerciaisAno = new Map<string, number>();
  const comerciaisMes = new Map<string, number>();
  const clientesAno = new Map<string, number>();
  let vendasMes = 0;
  let vendasAno = 0;
  let ytdAtual = 0;
  let ytdHomologo = 0;

  const tam = 200;
  const maxPaginas = 25;
  let page = 1;

  while (page <= maxPaginas) {
    const j = await apiGet(
      `/crm/v8/Deals?fields=Deal_Name,Stage,Amount,Closing_Date,Owner,Account_Name&page=${page}&per_page=${tam}`
    );
    const data = j.data ?? [];
    for (const d of data) {
      const stage = ((d.Stage as string) || "").toLowerCase();
      const ganho = stage.includes("won") || stage.includes("ganho");
      if (!ganho) continue;

      const valor = Number(d.Amount ?? 0) || 0;
      const dataFecho = (d.Closing_Date as string) || "";
      const a = Number(dataFecho.slice(0, 4));
      const m = Number(dataFecho.slice(5, 7));
      const owner = (d.Owner as { name?: string } | null)?.name || "(sem responsável)";
      const cliente = (d.Account_Name as { name?: string } | null)?.name || "(sem cliente)";

      if (a === ano) {
        vendasAno += valor;
        if (m >= 1 && m <= 12) meses[m - 1].valor += valor;
        comerciaisAno.set(owner, (comerciaisAno.get(owner) ?? 0) + valor);
        clientesAno.set(cliente, (clientesAno.get(cliente) ?? 0) + valor);
        if (m <= mes) ytdAtual += valor;
        if (m === mes) {
          vendasMes += valor;
          comerciaisMes.set(owner, (comerciaisMes.get(owner) ?? 0) + valor);
        }
      } else if (a === ano - 1) {
        if (m <= mes) ytdHomologo += valor;
      }
    }
    if (!j.info?.more_records) break;
    page += 1;
  }

  const arred = (n: number) => Math.round(n * 100) / 100;
  const ranking = (map: Map<string, number>) =>
    Array.from(map.entries())
      .map(([nome, valor]) => ({ nome, valor: arred(valor) }))
      .sort((x, y) => y.valor - x.valor);

  const topComMes = ranking(comerciaisMes);
  for (const x of meses) x.valor = arred(x.valor);

  return {
    ligado: true,
    ano,
    mes,
    vendas_mes: arred(vendasMes),
    vendas_ano: arred(vendasAno),
    ytd_atual: arred(ytdAtual),
    ytd_homologo: arred(ytdHomologo),
    evolucao_homologa:
      ytdHomologo > 0 ? Math.round(((ytdAtual - ytdHomologo) / ytdHomologo) * 1000) / 10 : null,
    meses,
    melhor_comercial_mes: topComMes[0] ?? null,
    top_comerciais_ano: ranking(comerciaisAno).slice(0, 5),
    top_clientes_ano: ranking(clientesAno).slice(0, 5),
  };
}
