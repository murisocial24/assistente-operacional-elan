// =====================================================================
// AUTENTICAÇÃO POR UTILIZADOR (leve, sem base de dados)
// ---------------------------------------------------------------------
// Utilizadores definidos na variável APP_USERS (JSON). Cada um tem nome,
// palavra-passe e os módulos a que pode aceder ("*" = todos).
//   APP_USERS = [{"u":"miguel","p":"...","m":"*"},{"u":"carla","p":"...","m":"comercial"}]
// A sessão é um cookie assinado (HMAC-SHA256) com SESSION_SECRET, por isso
// não pode ser forjado pelo lado do cliente.
//
// Retrocompatível: se APP_USERS não existir mas APP_PASSWORD existir, cria
// um utilizador único "equipa" com acesso a tudo e o login aceita só a
// palavra-passe (o campo de utilizador é ignorado). Assim a app atual não muda.
//
// Usa Web Crypto (globalThis.crypto) para funcionar tanto no middleware
// (Edge) como nas rotas (Node).
// =====================================================================

import type { ModuloKey } from "./config";

export type Utilizador = { u: string; p: string; m: ModuloKey[] | "*" };
export type Sessao = { u: string; m: ModuloKey[] | "*" };

const TODOS: ModuloKey[] = ["gestao", "logistica", "comercial"];

function modoPasswordUnica(): boolean {
  return !process.env.APP_USERS && !!process.env.APP_PASSWORD;
}

function normalizarModulos(m?: string): ModuloKey[] | "*" {
  if (!m || m.trim() === "*") return "*";
  const pedidos = m.split(",").map((s) => s.trim().toLowerCase());
  const ok = TODOS.filter((k) => pedidos.includes(k));
  return ok.length ? ok : "*";
}

export function getUtilizadores(): Utilizador[] {
  const raw = process.env.APP_USERS;
  if (raw) {
    try {
      const arr = JSON.parse(raw) as Array<{ u?: string; p?: string; m?: string }>;
      return arr
        .filter((x) => x.u && x.p)
        .map((x) => ({ u: String(x.u), p: String(x.p), m: normalizarModulos(x.m) }));
    } catch {
      // JSON inválido — ignora e tenta o fallback por palavra-passe.
    }
  }
  if (process.env.APP_PASSWORD) {
    return [{ u: "equipa", p: process.env.APP_PASSWORD, m: "*" }];
  }
  return [];
}

export function validarCredenciais(username: string, password: string): Sessao | null {
  const users = getUtilizadores();
  if (modoPasswordUnica()) {
    const u = users[0];
    return u && u.p === password ? { u: u.u, m: u.m } : null;
  }
  const u = users.find(
    (x) => x.u.toLowerCase() === username.trim().toLowerCase() && x.p === password
  );
  return u ? { u: u.u, m: u.m } : null;
}

export function podeAcederModulo(sessao: Sessao | null, key: string): boolean {
  if (!sessao) return false;
  if (sessao.m === "*") return true;
  return sessao.m.includes(key as ModuloKey);
}

// ---- assinatura do cookie (Web Crypto: Edge e Node) ----

function segredo(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.APP_USERS ||
    process.env.APP_PASSWORD ||
    "segredo-de-desenvolvimento-troca-isto"
  );
}

function b64urlFromBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlFromString(str: string): string {
  return b64urlFromBytes(new TextEncoder().encode(str));
}
function stringFromB64url(b64: string): string {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64urlFromBytes(new Uint8Array(sig));
}

const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

export async function criarToken(sessao: Sessao): Promise<string> {
  const payload = JSON.stringify({ u: sessao.u, m: sessao.m, exp: Date.now() + VALIDADE_MS });
  const corpo = b64urlFromString(payload);
  const assinatura = await hmac(corpo);
  return `${corpo}.${assinatura}`;
}

export async function verificarToken(token?: string | null): Promise<Sessao | null> {
  if (!token) return null;
  const partes = token.split(".");
  if (partes.length !== 2) return null;
  const [corpo, assinatura] = partes;
  const esperada = await hmac(corpo);
  if (assinatura !== esperada) return null;
  try {
    const obj = JSON.parse(stringFromB64url(corpo)) as {
      u: string;
      m: ModuloKey[] | "*";
      exp: number;
    };
    if (!obj.exp || Date.now() > obj.exp) return null;
    return { u: obj.u, m: obj.m };
  } catch {
    return null;
  }
}
