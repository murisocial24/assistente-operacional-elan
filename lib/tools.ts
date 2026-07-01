import type Anthropic from "@anthropic-ai/sdk";
import { consultarFaturacao, consultarRecurso, consultarVendasPorCliente, RECURSOS } from "@/lib/toconline";
import { consultarCrm, consultarPipeline, RECURSOS_CRM } from "@/lib/zoho";

// =====================================================================
// FERRAMENTAS DISPONÍVEIS PARA O CLAUDE
//  - consultar_faturas: resumo agregado de faturação num período.
//  - consultar_dados: listagem/contagem genérica de áreas do TOC Online.
// =====================================================================

const AREAS = Object.keys(RECURSOS);

export const toolsGestao: Anthropic.Tool[] = [
  {
    name: "consultar_faturas",
    description:
      "Resumo agregado da faturação entre duas datas (total faturado com e sem " +
      "IVA, IVA, valor por pagar e número de faturas). Usar para perguntas de " +
      "somatório financeiro num período. Datas em YYYY-MM-DD. Calcula o período " +
      "a partir da data de hoje, indicada no sistema. Sem período indicado, usa o mês atual.",
    input_schema: {
      type: "object",
      properties: {
        data_inicio: { type: "string", description: "Início do período (YYYY-MM-DD)." },
        data_fim: { type: "string", description: "Fim do período (YYYY-MM-DD)." },
      },
      required: ["data_inicio", "data_fim"],
    },
  },
  {
    name: "consultar_vendas_por_cliente",
    description:
      "Ranking de vendas por cliente: percorre TODOS os documentos de venda, " +
      "agrupa por cliente e soma o total com IVA. Usar para 'qual o cliente que " +
      "mais comprou', 'top clientes', 'vendas por cliente'. Opcionalmente filtra " +
      "por intervalo de datas (YYYY-MM-DD); sem datas, usa todo o histórico.",
    input_schema: {
      type: "object",
      properties: {
        data_inicio: { type: "string", description: "Opcional. Início do período (YYYY-MM-DD)." },
        data_fim: { type: "string", description: "Opcional. Fim do período (YYYY-MM-DD)." },
        top: { type: "integer", description: "Opcional. Quantos clientes no ranking (por omissão 25)." },
      },
      required: [],
    },
  },
  {
    name: "consultar_dados",
    description:
      "Consulta listagens de várias áreas do TOC Online (clientes, fornecedores, " +
      "compras, produtos, etc.). Usar para perguntas de listagem, procura ou " +
      "contagem ('quantos clientes tenho', 'quem são os fornecedores', 'procura o " +
      "cliente X'). Para listas grandes devolve uma amostra e o campo 'ha_mais' " +
      "indica se há mais registos além dos mostrados. Para somatórios de faturação, " +
      "usar antes a ferramenta consultar_faturas.",
    input_schema: {
      type: "object",
      properties: {
        recurso: {
          type: "string",
          enum: AREAS,
          description: "A área a consultar.",
        },
        pesquisa: {
          type: "string",
          description: "Opcional. Termo a procurar (ex.: nome de um cliente ou produto).",
        },
        limite: {
          type: "integer",
          description: "Opcional. Máximo de registos a devolver (1 a 50). Por omissão 20.",
        },
      },
      required: ["recurso"],
    },
  },
];

const AREAS_CRM = Object.keys(RECURSOS_CRM);

export const toolsComercial: Anthropic.Tool[] = [
  {
    name: "consultar_pipeline",
    description:
      "Visão do funil de negócios do Zoho CRM: agrupa os negócios (Deals) por fase, " +
      "com número e valor, e calcula negócios ganhos, perdidos, em aberto e a taxa de " +
      "conversão (ganhos vs perdidos). Usar para 'como está o pipeline', 'taxa de " +
      "conversão', 'quanto tenho em aberto'.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "consultar_crm",
    description:
      "Lista ou conta registos do Zoho CRM. Usar para perguntas sobre negócios, leads, " +
      "contactos, empresas/contas ou tarefas/atividades. Devolve uma amostra e o campo " +
      "'ha_mais' indica se há mais registos além dos mostrados.",
    input_schema: {
      type: "object",
      properties: {
        recurso: { type: "string", enum: AREAS_CRM, description: "A área do CRM a consultar." },
        limite: { type: "integer", description: "Opcional. Máximo de registos a devolver. Por omissão 20." },
      },
      required: ["recurso"],
    },
  },
];

function mensagemErroZoho(msg: string): { erro: string } {
  if (msg === "NAO_LIGADO") {
    return {
      erro:
        "A plataforma ainda não está ligada ao Zoho CRM. " +
        'Carrega no botão "Ligar Zoho CRM" e autoriza o acesso.',
    };
  }
  if (msg === "TOKEN_EXPIRADO") {
    return { erro: 'O acesso ao Zoho CRM expirou. Volta a ligar (botão "Ligar Zoho CRM").' };
  }
  return { erro: "Não foi possível obter os dados do Zoho CRM no momento." };
}

function mensagemErro(msg: string): { erro: string } | null {
  if (msg === "NAO_LIGADO") {
    return {
      erro:
        "A plataforma ainda não está ligada ao TOC Online. " +
        'Carrega no botão "Ligar TOC Online" e autoriza o acesso.',
    };
  }
  if (msg === "TOKEN_EXPIRADO") {
    return {
      erro: 'O acesso ao TOC Online expirou. Volta a ligar (botão "Ligar TOC Online").',
    };
  }
  if (msg === "RECURSO_INVALIDO") {
    return { erro: "Essa área não está disponível para consulta." };
  }
  return null;
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  try {
    if (name === "consultar_faturas") {
      return await consultarFaturacao(
        String(input.data_inicio ?? ""),
        String(input.data_fim ?? "")
      );
    }

    if (name === "consultar_vendas_por_cliente") {
      const dataInicio = input.data_inicio ? String(input.data_inicio) : undefined;
      const dataFim = input.data_fim ? String(input.data_fim) : undefined;
      const top = typeof input.top === "number" ? input.top : 25;
      return await consultarVendasPorCliente(dataInicio, dataFim, top);
    }

    if (name === "consultar_dados") {
      const recurso = String(input.recurso ?? "");
      const pesquisa = input.pesquisa ? String(input.pesquisa) : undefined;
      const limite = typeof input.limite === "number" ? input.limite : 20;
      return await consultarRecurso(recurso, pesquisa, limite);
    }

    if (name === "consultar_pipeline") {
      try {
        return await consultarPipeline();
      } catch (err) {
        return mensagemErroZoho(err instanceof Error ? err.message : "");
      }
    }

    if (name === "consultar_crm") {
      try {
        const recurso = String(input.recurso ?? "");
        const limite = typeof input.limite === "number" ? input.limite : 20;
        return await consultarCrm(recurso, limite);
      } catch (err) {
        return mensagemErroZoho(err instanceof Error ? err.message : "");
      }
    }

    return { erro: `Ferramenta desconhecida: ${name}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    return (
      mensagemErro(msg) ?? { erro: "Não foi possível obter os dados do TOC Online no momento." }
    );
  }
}
