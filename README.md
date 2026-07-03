# Assistente Operacional — Fase 0

Esqueleto de uma plataforma de chat onde o dono e os colaboradores da empresa
fazem perguntas sobre a atividade do negócio. Nesta fase 0, o assistente já
funciona de ponta a ponta (login + chat + ciclo do Claude com ferramentas),
mas com **uma ferramenta de exemplo** que devolve dados fixos. As ligações
reais ao TOC Online e ao Salesforce entram nas fases seguintes.

## O que já faz

- Página de login simples (palavra-passe partilhada).
- Interface de chat.
- Backend que corre o **ciclo agêntico** com o Claude: o modelo decide quando
  chamar a ferramenta `consultar_faturas`, o servidor executa-a, devolve o
  resultado ao Claude e este formula a resposta final.

## Estrutura

```
app/
  page.tsx              Interface de chat
  login/page.tsx        Página de login
  api/chat/route.ts     Ciclo agêntico (Claude + ferramentas)
  api/login/route.ts    Valida a palavra-passe
lib/tools.ts            Definição e execução das ferramentas  <-- onde se ligam os sistemas
middleware.ts           Porta de autenticação
```

## Correr localmente

1. Copia `.env.example` para `.env.local` e preenche os valores:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   APP_PASSWORD=uma-password-tua
   ```
2. Instala e arranca:
   ```
   npm install
   npm run dev
   ```
3. Abre http://localhost:3000 — vai pedir a palavra-passe.

## Pôr no GitHub

```
git init
git add .
git commit -m "Fase 0: esqueleto do assistente operacional"
git branch -M main
git remote add origin <URL-do-teu-repositorio>
git push -u origin main
```

(O `.gitignore` já garante que `node_modules`, `.next` e os ficheiros `.env`
**não** são enviados — as chaves nunca vão para o GitHub.)

## Deploy no Render (plano gratuito)

1. Em https://render.com cria um **New > Web Service** e liga o repositório do GitHub.
2. Configuração:
   - **Environment:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
3. Em **Environment** adiciona as variáveis (as mesmas do `.env.example`):
   - `ANTHROPIC_API_KEY`
   - `APP_PASSWORD`
   - `ANTHROPIC_MODEL` (opcional)
4. Faz deploy. O Render dá-te um URL público.

> Nota: no plano gratuito o serviço adormece após ~15 min sem uso; o primeiro
> pedido seguinte demora 30–60 s a acordar. É normal nesta fase.

## Ligar o TOC Online (botão na app)

A app tem um botão "Ligar TOC Online" que faz todo o fluxo OAuth. O dono/cliente
carrega, faz login no TOC Online, autoriza, e volta já ligado.

Pré-requisitos (obtidos no TOC Online, em "Empresa > Dados API", normalmente
com a ajuda do contabilista):
- `client_id` e `client_secret` da empresa.
- O número correto do URL da conta (ex.: `api10` / `app10`).
- O endereço de retorno (redirect URI) abaixo TEM de ser registado no TOC Online:
  `https://assistente-operacional.onrender.com/api/toconline/callback`

Variáveis a configurar no Render:
- `TOCONLINE_API_BASE` — ex.: `https://api40.toconline.pt`
- `TOCONLINE_OAUTH_BASE` — ex.: `https://app40.toconline.pt/oauth`
- `TOCONLINE_CLIENT_ID`, `TOCONLINE_CLIENT_SECRET`
- `TOCONLINE_REDIRECT_URI` — o endereço acima
- `APP_BASE_URL` — `https://assistente-operacional.onrender.com`

Depois de "Ligar TOC Online", a app mostra um `refresh_token`. Cola-o no Render em
`TOCONLINE_REFRESH_TOKEN` para a ligação sobreviver a reinícios do servidor (a app
renova o acesso sozinha a partir daí).

> Armadilha nº 1: se o redirect URI não estiver registado/igual no TOC Online, a
> autorização falha. A própria app mostra qual o endereço que usou, para comparares.

## Áreas consultáveis (ferramenta consultar_dados)

Além do resumo de faturação, o assistente consulta listagens destas áreas do
TOC Online: clientes, fornecedores, contactos, produtos, serviços, famílias de
artigos, vendas, recibos de venda, compras, pagamentos a fornecedores, categorias
de despesa, contas bancárias e contas de caixa. Para listas grandes devolve uma
amostra e indica se há mais registos. Para acrescentar novas áreas ou cálculos
específicos, editar `lib/toconline.ts` (mapa `RECURSOS`) e `lib/tools.ts`.

## Próximas fases

- ~~**Fase 1:** ligar o TOC Online (faturação).~~ ✅ feito.
- ~~**Consulta genérica:** clientes, fornecedores, produtos, serviços, compras, recibos, contactos (só leitura).~~ ✅ feito (ferramenta `consultar_dados`).
- **Fase 2:** Salesforce (OAuth) e ferramentas de soma/cruzamento para compras.
- **Fase 3:** streaming das respostas, cache, e autenticação real por utilizador.
