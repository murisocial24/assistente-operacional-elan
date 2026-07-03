import { NextResponse } from "next/server";
import { apiPost, getCompanyId, isConnected } from "@/lib/moloni";

export const runtime = "nodejs";
export const maxDuration = 300;

// DIAGNÓSTICO (temporário): valida a ligação e mostra a estrutura real dos
// dados do Moloni antes de os ligar à interface. Remover antes de produção.
export async function GET() {
  if (!isConnected()) {
    return NextResponse.json(
      { erro: "Moloni ainda não está ligado. Abra /api/moloni/connect para autorizar." },
      { status: 400 }
    );
  }
  try {
    const empresas = await apiPost("companies/getAll");
    const companyId = await getCompanyId();

    let campos_documento: string[] = [];
    let amostra_documentos: unknown = null;
    if (companyId) {
      const docs = await apiPost("documents/getAll", { company_id: companyId, offset: 0, qty: 3 });
      amostra_documentos = docs;
      if (Array.isArray(docs) && docs.length && docs[0] && typeof docs[0] === "object") {
        campos_documento = Object.keys(docs[0] as Record<string, unknown>);
      }
    }

    return NextResponse.json({
      nota: "Diagnóstico Moloni — empresas e estrutura de documentos.",
      company_id_usado: companyId,
      EMPRESAS: empresas,
      DOCUMENTOS: { campos: campos_documento, amostra: amostra_documentos },
    });
  } catch (err) {
    return NextResponse.json(
      { erro: err instanceof Error ? err.message : "Erro desconhecido no diagnóstico." },
      { status: 500 }
    );
  }
}
