// =====================================================================
// CONFIGURAÇÃO POR CLIENTE (instância)
// ---------------------------------------------------------------------
// Tudo o que muda de cliente para cliente vive aqui e é lido de variáveis
// de ambiente. SEM variáveis definidas, os valores por omissão mantêm o
// comportamento do cliente atual (TOC Online + tema esmeralda + 3 módulos),
// por isso a app existente NÃO é afetada.
// =====================================================================

export type ModuloKey = "gestao" | "logistica" | "comercial";
export type ErpProvider = "toconline" | "moloni" | "none";
export type CrmProvider = "zoho" | "salesforce" | "none";

const TODOS_MODULOS: ModuloKey[] = ["gestao", "logistica", "comercial"];

// --- Que integrações já estão IMPLEMENTADAS no código (não só configuradas) ---
// Quando o módulo Moloni ficar pronto, mete moloni: true.
const ERP_IMPLEMENTADO: Record<ErpProvider, boolean> = {
  toconline: true,
  moloni: false,
  none: false,
};
const CRM_IMPLEMENTADO: Record<CrmProvider, boolean> = {
  zoho: true,
  salesforce: false,
  none: false,
};

const ERP_LABEL: Record<ErpProvider, string> = {
  toconline: "TOC Online",
  moloni: "Moloni",
  none: "Fonte de dados por definir",
};
const CRM_LABEL: Record<CrmProvider, string> = {
  zoho: "Zoho CRM",
  salesforce: "Salesforce",
  none: "CRM por definir",
};

export function erpProvider(): ErpProvider {
  const v = (process.env.ERP_PROVIDER || "").toLowerCase();
  if (v === "moloni" || v === "toconline" || v === "none") return v;
  return "toconline"; // omissão: cliente atual
}

export function crmProvider(): CrmProvider {
  const v = (process.env.CRM_PROVIDER || "").toLowerCase();
  if (v === "zoho" || v === "salesforce" || v === "none") return v;
  // auto: se houver configuração Zoho, assume Zoho; senão, nenhum.
  if (process.env.ZOHO_REFRESH_TOKEN || process.env.ZOHO_CLIENT_ID) return "zoho";
  return "none";
}

export function erpLabel(): string {
  return ERP_LABEL[erpProvider()];
}
export function crmLabel(): string {
  return CRM_LABEL[crmProvider()];
}

// --- Marca / aspeto -------------------------------------------------
export type TemaVars = Record<string, string>;

// Cada tema é um conjunto de overrides das variáveis CSS de globals.css.
// "esmeralda" = vazio => usa os valores por omissão (cliente atual).
const TEMAS: Record<string, TemaVars> = {
  esmeralda: {},
  tinta: {
    "--ink": "#15171c",
    "--ink-soft": "#474c55",
    "--muted": "#888e98",
    "--paper-1": "#f6f7f9",
    "--paper-2": "#eceef1",
    "--surface": "#ffffff",
    "--border": "#e6e8ec",
    "--border-strong": "#d4d8de",
    "--accent": "#15171c",
    "--accent-2": "#3a3f49",
    "--accent-ink": "#0a0c0f",
  },
};

export type Brand = {
  nome: string;
  subtitulo: string;
  logo: string | null;
  tema: string;
  temaVars: TemaVars;
  themeColor: string;
};

export function getBrand(): Brand {
  const tema = (process.env.BRAND_THEME || "esmeralda").toLowerCase();
  const temaVars = TEMAS[tema] ?? TEMAS.esmeralda;
  return {
    nome: process.env.BRAND_NAME || "Assistente Operacional",
    subtitulo: process.env.BRAND_SUBTITLE || "Assistente operacional da empresa",
    logo: process.env.BRAND_LOGO || null,
    tema,
    temaVars,
    themeColor: temaVars["--accent"] || "#0f7a5a",
  };
}

// --- Módulos --------------------------------------------------------
export type Ligacao = {
  provider: string;
  statusUrl: string;
  connectUrl: string;
  label: string;
};

export type ModuloInfo = {
  key: ModuloKey;
  nome: string;
  fonte: string; // etiqueta da fonte de dados (ERP/CRM)
  desc: string;
  disponivel: boolean; // integração implementada e configurada
  sugestoes: string[];
  ligacao: Ligacao | null; // botão "Ligar X" quando há fluxo OAuth disponível
};

const DESC: Record<ModuloKey, string> = {
  gestao: "Faturação, vendas, clientes, fornecedores e contas.",
  logistica: "Stock, armazém, expedições e rotação de existências.",
  comercial: "Pipeline, leads, contactos e taxas de conversão.",
};
const SUGESTOES: Record<ModuloKey, string[]> = {
  gestao: [
    "Quanto faturámos no mês passado?",
    "Que clientes compraram mais este ano?",
    "Quantos clientes tenho?",
  ],
  logistica: [],
  comercial: [
    "Como está o meu pipeline?",
    "Qual é a taxa de conversão?",
    "Quantos leads tenho?",
  ],
};

function nomeModulo(key: ModuloKey): string {
  const env = process.env[`MODULO_${key.toUpperCase()}_NOME`];
  if (env) return env;
  return key === "gestao" ? "Gestão" : key === "logistica" ? "Logística" : "Comercial";
}

export function modulosAtivos(): ModuloKey[] {
  const raw = process.env.ENABLED_MODULES;
  if (!raw) return TODOS_MODULOS; // omissão: todos (cliente atual)
  const pedidos = raw.split(",").map((s) => s.trim().toLowerCase());
  return TODOS_MODULOS.filter((k) => pedidos.includes(k));
}

function infoGestao(): ModuloInfo {
  const erp = erpProvider();
  const ligacao: Ligacao | null =
    erp === "toconline"
      ? {
          provider: "toconline",
          statusUrl: "/api/toconline/status",
          connectUrl: "/api/toconline/connect",
          label: "TOC Online",
        }
      : null;
  return {
    key: "gestao",
    nome: nomeModulo("gestao"),
    fonte: ERP_LABEL[erp],
    desc: DESC.gestao,
    disponivel: ERP_IMPLEMENTADO[erp],
    sugestoes: SUGESTOES.gestao,
    ligacao,
  };
}

function infoComercial(): ModuloInfo {
  const crm = crmProvider();
  const ligacao: Ligacao | null =
    crm === "zoho"
      ? {
          provider: "zoho",
          statusUrl: "/api/zoho/status",
          connectUrl: "/api/zoho/connect",
          label: "Zoho CRM",
        }
      : null;
  return {
    key: "comercial",
    nome: nomeModulo("comercial"),
    fonte: CRM_LABEL[crm],
    desc: DESC.comercial,
    disponivel: CRM_IMPLEMENTADO[crm],
    sugestoes: SUGESTOES.comercial,
    ligacao,
  };
}

function infoLogistica(): ModuloInfo {
  return {
    key: "logistica",
    nome: nomeModulo("logistica"),
    fonte: "Fonte de dados por definir",
    desc: DESC.logistica,
    disponivel: false,
    sugestoes: [],
    ligacao: null,
  };
}

export function getModulos(): ModuloInfo[] {
  const mapa: Record<ModuloKey, () => ModuloInfo> = {
    gestao: infoGestao,
    comercial: infoComercial,
    logistica: infoLogistica,
  };
  return modulosAtivos().map((k) => mapa[k]());
}

export function getModulo(key: string): ModuloInfo | null {
  return getModulos().find((m) => m.key === key) ?? null;
}
