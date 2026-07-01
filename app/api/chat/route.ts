import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { toolsGestao, toolsComercial, executeTool } from "@/lib/tools";
import { verificarToken, podeAcederModulo } from "@/lib/auth";
import { erpProvider, crmProvider, erpLabel, crmLabel } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 300;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

const BASE =
  "Responde sempre em português de Portugal, de forma clara e direta. " +
  "Nunca inventes valores nem dados: se não tiveres ferramenta ou fonte para " +
  "responder, di-lo com honestidade.";

const PROMPT_GESTAO = `És o assistente do departamento de GESTÃO / CONTABILIDADE de uma empresa, ligado ao TOC Online.
Respondes a perguntas sobre faturação, vendas, clientes, fornecedores, compras,
produtos e contas, consultando o TOC Online através das ferramentas.

Ferramentas:
- consultar_faturas: somatórios de faturação num período (totais, IVA, por pagar).
- consultar_vendas_por_cliente: ranking de vendas por cliente (total completo).
- consultar_dados: listar/procurar/contar clientes, fornecedores, produtos, compras, etc.

Usa a ferramenta certa para cada pergunta. Se um resultado trouxer "ha_mais": true,
avisa que há mais registos além dos mostrados. ${BASE}`;

const PROMPT_COMERCIAL = `És o assistente do departamento COMERCIAL de uma empresa, ligado ao Zoho CRM.
Respondes sobre o pipeline de negócios, leads, contactos, empresas, tarefas/atividades
e taxas de conversão, consultando o Zoho CRM através das ferramentas.

Ferramentas:
- consultar_pipeline: funil de negócios por fase, valores, ganhos/perdidos e taxa de conversão.
- consultar_crm: listar/contar negócios, leads, contactos, empresas ou tarefas.

Usa a ferramenta certa para cada pergunta. Se uma ferramenta devolver um campo "erro"
a dizer que o Zoho CRM não está ligado, explica que é preciso carregar em "Ligar Zoho CRM".
Se um resultado trouxer "ha_mais": true, avisa que há mais registos além dos mostrados. ${BASE}`;

const PROMPT_PENDENTE = (area: string, fonte: string) =>
  `És o assistente do departamento de ${area} de uma empresa.
Este módulo ainda NÃO tem integração de dados ligada — a ligação a ${fonte} está por definir.
Quando te pedirem dados desta área, explica com clareza e simpatia que a integração ainda
não está disponível e que será adicionada em breve. Não inventes dados nem valores. Podes na
mesma conversar e ajudar a pensar sobre o tema. ${BASE}`;

function configChat(modulo: string): { system: string; tools: Anthropic.Tool[] } {
  if (modulo === "gestao") {
    if (erpProvider() === "toconline") return { system: PROMPT_GESTAO, tools: toolsGestao };
    return { system: PROMPT_PENDENTE("GESTÃO / CONTABILIDADE", erpLabel()), tools: [] };
  }
  if (modulo === "comercial") {
    if (crmProvider() === "zoho") return { system: PROMPT_COMERCIAL, tools: toolsComercial };
    return { system: PROMPT_PENDENTE("COMERCIAL", crmLabel()), tools: [] };
  }
  return { system: PROMPT_PENDENTE("LOGÍSTICA", "um sistema de stock/armazém"), tools: [] };
}

type ClientMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { erro: "ANTHROPIC_API_KEY não está configurada no servidor." },
      { status: 500 }
    );
  }

  let body: { messages?: ClientMessage[]; modulo?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "Corpo do pedido inválido." }, { status: 400 });
  }

  const modulo = body.modulo ?? "gestao";

  // Acesso: o utilizador da sessão tem de poder usar este módulo.
  const jar = await cookies();
  const sessao = await verificarToken(jar.get("sessao")?.value);
  if (!podeAcederModulo(sessao, modulo)) {
    return NextResponse.json({ erro: "Sem acesso a este módulo." }, { status: 403 });
  }

  const { system, tools } = configChat(modulo);

  const conversation: Anthropic.MessageParam[] = (body.messages ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const hoje = new Date().toISOString().slice(0, 10);
  const systemComData = `${system}\n\nData de hoje: ${hoje}. Usa-a para calcular períodos relativos (ex.: "mês passado").`;

  try {
    for (let step = 0; step < 8; step++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: systemComData,
        messages: conversation,
        tools: tools.length ? tools : undefined,
      });

      if (response.stop_reason === "tool_use") {
        conversation.push({ role: "assistant", content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === "tool_use") {
            const result = await executeTool(
              block.name,
              block.input as Record<string, unknown>
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }

        conversation.push({ role: "user", content: toolResults });
        continue;
      }

      const reply = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      return NextResponse.json({ reply });
    }

    return NextResponse.json({
      reply: "Não consegui concluir o pedido (demasiados passos seguidos).",
    });
  } catch (err) {
    console.error("Erro na chamada à Anthropic:", err);
    return NextResponse.json(
      { erro: "Ocorreu um erro ao falar com o modelo. Verifica a chave da API e os créditos." },
      { status: 500 }
    );
  }
}
