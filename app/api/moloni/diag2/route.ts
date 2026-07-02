import { NextResponse } from "next/server";
import { apiPost, getCompanyId, isConnected, garantirRefreshCarregado } from "@/lib/moloni";

export const runtime = "nodejs";
export const maxDuration = 300;

// DIAGNÓSTICO AVANÇADO (temporário): valida a base de dados necessária para as
// métricas de margem, comercial e stock ANTES de as construir.
// - COMERCIAIS: mapear salesman_id -> nome
// - DOCUMENTO_DETALHE: linhas do documento (para ver se trazem custo/referência)
// - PRODUTOS: preço de custo, stock e referência
async function tenta(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "erro" };
  }
}

function chaves(x: unknown): string[] {
  return x && typeof x === "object" ? Object.keys(x as Record<string, unknown>) : [];
}

export async function GET() {
  await garantirRefreshCarregado();
  if (!isConnected()) {
    return NextResponse.json(
      { erro: "Moloni não está ligado. Abra /api/moloni/connect para autorizar." },
      { status: 400 }
    );
  }

  const companyId = await getCompanyId();

  // Comerciais — tentamos os dois nomes de endpoint mais prováveis.
  const comerciais_salesmen = await tenta(() => apiPost("salesmen/getAll", { company_id: companyId }));
  const comerciais_users = await tenta(() => apiPost("users/getAll", { company_id: companyId }));

  // Documento recente em detalhe (linhas/produtos).
  const ultimos = await tenta(() =>
    apiPost("documents/getAll", { company_id: companyId, offset: 0, qty: 1 })
  );
  let docId: number | null = null;
  if (Array.isArray(ultimos) && ultimos.length) {
    docId = (ultimos[0] as { document_id?: number }).document_id ?? null;
  }
  const documentoDetalhe = docId
    ? await tenta(() => apiPost("documents/getOne", { company_id: companyId, document_id: docId }))
    : null;

  const linhas =
    documentoDetalhe && typeof documentoDetalhe === "object" && "products" in documentoDetalhe
      ? (documentoDetalhe as { products?: unknown[] }).products
      : undefined;
  const camposLinha = Array.isArray(linhas) && linhas.length ? chaves(linhas[0]) : [];

  // Produtos (custo/stock/referência).
  const produtos = await tenta(() =>
    apiPost("products/getAll", { company_id: companyId, offset: 0, qty: 2 })
  );
  const camposProduto = Array.isArray(produtos) && produtos.length ? chaves(produtos[0]) : [];

  return NextResponse.json({
    nota: "Diagnóstico avançado para métricas (margem, comercial, stock).",
    company_id: companyId,
    COMERCIAIS_salesmen: comerciais_salesmen,
    COMERCIAIS_users: comerciais_users,
    DOCUMENTO_DETALHE: {
      document_id: docId,
      campos_da_linha: camposLinha,
      linhas_amostra: Array.isArray(linhas) ? linhas.slice(0, 2) : linhas,
    },
    PRODUTOS: { campos: camposProduto, amostra: produtos },
  });
}
