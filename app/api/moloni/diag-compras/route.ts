import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verificarToken, podeAcederModulo } from "@/lib/auth";
import { apiPost, getCompanyId, isConnected, garantirRefreshCarregado } from "@/lib/moloni";

export const runtime = "nodejs";
export const maxDuration = 120;

// DIAGNÓSTICO DE COMPRAS (temporário): testa os vários endpoints de
// documentos de fornecedor do Moloni e mostra qual tem dados da ELANDERMA.
function chaves(x: unknown): string[] {
  return Array.isArray(x) && x.length && x[0] && typeof x[0] === "object"
    ? Object.keys(x[0] as Record<string, unknown>)
    : [];
}

export async function GET() {
  const jar = await cookies();
  const sessao = await verificarToken(jar.get("sessao")?.value);
  if (!podeAcederModulo(sessao, "gestao")) {
    return NextResponse.json({ erro: "Sem acesso." }, { status: 403 });
  }
  await garantirRefreshCarregado();
  if (!isConnected()) {
    return NextResponse.json({ erro: "Moloni não está ligado." }, { status: 400 });
  }

  const companyId = await getCompanyId();
  const candidatos = [
    "supplierInvoices/getAll",
    "invoices/getAll",
    "supplierSimplifiedInvoices/getAll",
    "supplierPurchaseOrder/getAll",
    "supplierCreditNotes/getAll",
    "supplierReceipts/getAll",
  ];

  const resultados: Record<string, unknown> = {};
  for (const ep of candidatos) {
    try {
      const r = await apiPost(ep, { company_id: companyId, offset: 0, qty: 3 });
      if (Array.isArray(r)) {
        resultados[ep] = { ok: true, n_registos: r.length, campos: chaves(r), amostra: r.slice(0, 2) };
      } else {
        resultados[ep] = { ok: false, resposta: r };
      }
    } catch (e) {
      resultados[ep] = { erro: e instanceof Error ? e.message : "erro" };
    }
  }

  return NextResponse.json({
    nota: "Diagnóstico de compras — que endpoints de documentos de fornecedor têm dados.",
    company_id: companyId,
    resultados,
  });
}
