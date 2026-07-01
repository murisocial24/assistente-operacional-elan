"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = { role: "user" | "assistant"; content: string };

type Ligacao = {
  provider: string;
  statusUrl: string;
  connectUrl: string;
  label: string;
} | null;

type Modulo = {
  key: string;
  nome: string;
  fonte: string;
  desc: string;
  disponivel: boolean;
  sugestoes: string[];
  ligacao: Ligacao;
};

type Brand = { nome: string; subtitulo: string; logo: string | null };

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const eur0 = (n: number) =>
  (n || 0).toLocaleString("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const pctSigned = (n: number | null) =>
  n === null || n === undefined
    ? "—"
    : `${n > 0 ? "+" : ""}${n.toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`;

const pctPlain = (n: number | null) =>
  n === null || n === undefined
    ? "—"
    : `${n.toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`;

type Kpis = {
  ligado: boolean;
  ano: number;
  meses: Array<{ mes: number; receitas: number; despesas: number }>;
  total_receitas: number;
  total_despesas: number;
  evolucao_receitas: number | null;
  evolucao_despesas: number | null;
  liquidez_media: number | null;
};

function DashboardGestao({ fonte, disponivel }: { fonte: string; disponivel: boolean }) {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);

  function carregar() {
    setLoading(true);
    fetch("/api/gestao/kpis")
      .then((r) => r.json())
      .then((d: Kpis) => setKpis(d))
      .catch(() => setKpis(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
  }, []);

  const ano = kpis?.ano ?? new Date().getFullYear();
  const meses = kpis?.meses ?? MESES.map((_, i) => ({ mes: i + 1, receitas: 0, despesas: 0 }));
  const max = Math.max(1, ...meses.map((m) => Math.max(m.receitas, m.despesas)));
  const h = (v: number) => `${Math.max(2, Math.round((v / max) * 100))}%`;
  const ligado = kpis?.ligado ?? false;

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h2 className="dash-title">Métricas</h2>
          <p className="dash-sub">Receitas e despesas · {ano} · com IVA</p>
        </div>
        <button className="refresh" onClick={carregar} aria-label="Atualizar" disabled={loading}>
          ↻
        </button>
      </div>

      {!ligado && (
        <div className="hint">
          {disponivel
            ? `Ligue ${fonte} para ver dados reais. Até lá, as métricas aparecem a zero.`
            : `A ligação a ${fonte} ainda não está disponível. As métricas aparecem a zero por agora.`}
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <span className="stat-label">Evolução receitas</span>
          <span
            className={`stat-val ${
              (kpis?.evolucao_receitas ?? 0) > 0
                ? "up"
                : (kpis?.evolucao_receitas ?? 0) < 0
                ? "down"
                : ""
            }`}
          >
            {pctSigned(kpis?.evolucao_receitas ?? null)}
          </span>
          <span className="stat-foot">1.º → último mês com dados</span>
        </div>
        <div className="stat">
          <span className="stat-label">Evolução despesas</span>
          <span
            className={`stat-val ${
              (kpis?.evolucao_despesas ?? 0) > 0
                ? "down"
                : (kpis?.evolucao_despesas ?? 0) < 0
                ? "up"
                : ""
            }`}
          >
            {pctSigned(kpis?.evolucao_despesas ?? null)}
          </span>
          <span className="stat-foot">1.º → último mês com dados</span>
        </div>
        <div className="stat">
          <span className="stat-label">Liquidez média mensal</span>
          <span className="stat-val">{pctPlain(kpis?.liquidez_media ?? null)}</span>
          <span className="stat-foot">(receitas − despesas) ÷ receitas</span>
        </div>
      </div>

      <div className="chart-card">
        <div className="chart-head">
          <span className="chart-title">Receitas vs Despesas</span>
          <span className="legend">
            <i className="lg rec" />Receitas <i className="lg desp" />Despesas
          </span>
        </div>
        <div className="bars">
          {meses.map((m) => (
            <div
              className="bargroup"
              key={m.mes}
              title={`${MESES[m.mes - 1]}: Receitas ${eur0(m.receitas)} · Despesas ${eur0(m.despesas)}`}
            >
              <div className="barpair">
                <div className="bar rec" style={{ height: h(m.receitas) }} />
                <div className="bar desp" style={{ height: h(m.despesas) }} />
              </div>
              <span className="barlbl">{MESES[m.mes - 1]}</span>
            </div>
          ))}
        </div>
        <div className="totais">
          <div>
            <i className="lg rec" /> Total receitas <strong>{eur0(kpis?.total_receitas ?? 0)}</strong>
          </div>
          <div>
            <i className="lg desp" /> Total despesas <strong>{eur0(kpis?.total_despesas ?? 0)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

type KpisComercial = {
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

function DashboardComercial({ fonte, disponivel }: { fonte: string; disponivel: boolean }) {
  const [kpis, setKpis] = useState<KpisComercial | null>(null);
  const [loading, setLoading] = useState(true);

  function carregar() {
    setLoading(true);
    fetch("/api/comercial/kpis")
      .then((r) => r.json())
      .then((d: KpisComercial) => setKpis(d))
      .catch(() => setKpis(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
  }, []);

  const ano = kpis?.ano ?? new Date().getFullYear();
  const ligado = kpis?.ligado ?? false;
  const meses = kpis?.meses ?? MESES.map((_, i) => ({ mes: i + 1, valor: 0 }));
  const max = Math.max(1, ...meses.map((m) => m.valor));
  const h = (v: number) => `${Math.max(2, Math.round((v / max) * 100))}%`;

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h2 className="dash-title">Métricas</h2>
          <p className="dash-sub">Vendas · {ano}</p>
        </div>
        <button className="refresh" onClick={carregar} aria-label="Atualizar" disabled={loading}>
          ↻
        </button>
      </div>

      {!ligado && (
        <div className="hint">
          {disponivel
            ? `Ligue ${fonte} para ver dados reais. Até lá, as métricas aparecem a zero.`
            : `Fonte de dados comercial por definir (${fonte}). As métricas aparecem a zero por agora.`}
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <span className="stat-label">Vendas (mês)</span>
          <span className="stat-val">{eur0(kpis?.vendas_mes ?? 0)}</span>
          <span className="stat-foot">negócios ganhos no mês</span>
        </div>
        <div className="stat">
          <span className="stat-label">Vendas (ano)</span>
          <span className="stat-val">{eur0(kpis?.vendas_ano ?? 0)}</span>
          <span className="stat-foot">negócios ganhos em {ano}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Evolução homóloga</span>
          <span
            className={`stat-val ${
              (kpis?.evolucao_homologa ?? 0) > 0
                ? "up"
                : (kpis?.evolucao_homologa ?? 0) < 0
                ? "down"
                : ""
            }`}
          >
            {pctSigned(kpis?.evolucao_homologa ?? null)}
          </span>
          <span className="stat-foot">{ano} vs {ano - 1} (mesmo período)</span>
        </div>
      </div>

      <div className="chart-card">
        <div className="chart-head">
          <span className="chart-title">Vendas por mês</span>
          <span className="legend">
            <i className="lg rec" />Ganhos
          </span>
        </div>
        <div className="bars">
          {meses.map((m) => (
            <div className="bargroup" key={m.mes} title={`${MESES[m.mes - 1]}: ${eur0(m.valor)}`}>
              <div className="barpair">
                <div className="bar rec" style={{ height: h(m.valor) }} />
              </div>
              <span className="barlbl">{MESES[m.mes - 1]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="hl-card">
        <span className="hl-label">Melhor comercial do mês</span>
        <span className="hl-name">{kpis?.melhor_comercial_mes?.nome ?? "—"}</span>
        <span className="hl-val">{kpis?.melhor_comercial_mes ? eur0(kpis.melhor_comercial_mes.valor) : ""}</span>
      </div>

      <div className="dtable-card">
        <div className="dtable-title">Melhores comerciais ({ano})</div>
        <table className="dtable">
          <tbody>
            {(kpis?.top_comerciais_ano ?? []).length === 0 ? (
              <tr><td className="empty-cell">Sem dados</td><td></td></tr>
            ) : (
              kpis!.top_comerciais_ano.map((c, i) => (
                <tr key={i}>
                  <td>{c.nome}</td>
                  <td className="num">{eur0(c.valor)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="dtable-card">
        <div className="dtable-title">Melhores clientes ({ano})</div>
        <table className="dtable">
          <tbody>
            {(kpis?.top_clientes_ano ?? []).length === 0 ? (
              <tr><td className="empty-cell">Sem dados</td><td></td></tr>
            ) : (
              kpis!.top_clientes_ano.map((c, i) => (
                <tr key={i}>
                  <td>{c.nome}</td>
                  <td className="num">{eur0(c.valor)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="dtable-card">
        <div className="dtable-title">Vendas por produto/serviço</div>
        <p className="config-note">
          Por configurar — depende da fonte de dados comercial. O detalhe por produto costuma vir
          da faturação; podemos ligá-lo a essa fonte quando estiver definida.
        </p>
      </div>
    </div>
  );
}

export default function Page() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [modulos, setModulos] = useState<Modulo[] | null>(null);
  const [modulo, setModulo] = useState<Modulo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ligado, setLigado] = useState<boolean | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const b = (window as unknown as { __BRAND__?: Brand }).__BRAND__;
    if (b) setBrand(b);
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setModulos(Array.isArray(d.modulos) ? d.modulos : []))
      .catch(() => setModulos([]));
  }, []);

  // Estado da ligação do módulo aberto (se tiver fluxo de ligação).
  useEffect(() => {
    setLigado(null);
    const url = modulo?.ligacao?.statusUrl;
    if (!url) return;
    fetch(url)
      .then((r) => r.json())
      .then((d) => setLigado(Boolean(d.ligado)))
      .catch(() => setLigado(null));
  }, [modulo]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function abrirModulo(m: Modulo) {
    setModulo(m);
    setMessages([]);
    setInput("");
  }

  function autoGrow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }

  async function send(texto?: string) {
    const text = (texto ?? input).trim();
    if (!text || loading || !modulo) return;

    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, modulo: modulo.key }),
      });
      const data = await res.json();
      const reply = data.reply ?? data.erro ?? "Não obtive resposta do servidor.";
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch {
      setMessages([
        ...next,
        { role: "assistant", content: "Não consegui ligar ao servidor. Tenta novamente." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const nomeApp = brand?.nome ?? "Assistente Operacional";

  // ---------------- Painel de seleção de módulos ----------------
  if (!modulo) {
    return (
      <div className="picker-wrap">
        <div className="picker">
          <div className="brand center">
            {brand?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="brand-logo" src={brand.logo} alt={nomeApp} />
            ) : (
              <div className="brand-mark" />
            )}
            <div>
              <h1>{nomeApp}</h1>
              <p className="sub">Escolha um módulo para começar.</p>
            </div>
          </div>

          {modulos === null ? (
            <div className="modules-loading">A carregar…</div>
          ) : modulos.length === 0 ? (
            <div className="modules-loading">Sem módulos disponíveis para este utilizador.</div>
          ) : (
            <div className="modules">
              {modulos.map((m) => (
                <button key={m.key} className="module-card" onClick={() => abrirModulo(m)}>
                  <div className="module-top">
                    <span className="module-mark" data-mod={m.key} />
                    <span className={`tag ${m.disponivel ? "tag-on" : "tag-soon"}`}>
                      {m.disponivel ? "Ativo" : "Em preparação"}
                    </span>
                  </div>
                  <h3>{m.nome}</h3>
                  <p className="module-desc">{m.desc}</p>
                  <p className="module-fonte">{m.fonte}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------- Conteúdo do chat (reutilizado) ----------------
  const chatContent = (
    <>
      <header className="header">
        <button className="back" onClick={() => setModulo(null)}>
          ← Módulos
        </button>
        <div className="brand">
          <span className="module-mark" data-mod={modulo.key} />
          <div>
            <h1>{modulo.nome}</h1>
            <p className="sub">{modulo.desc}</p>
          </div>
        </div>
        <div className="toc-bar">
          {modulo.ligacao ? (
            ligado === true ? (
              <span className="pill on">
                <span className="dot" /> {modulo.ligacao.label} ligado
              </span>
            ) : ligado === false ? (
              <>
                <span className="pill off">
                  <span className="dot" /> {modulo.ligacao.label} por ligar
                </span>
                <a className="toc-link" href={modulo.ligacao.connectUrl}>
                  Ligar {modulo.ligacao.label}
                </a>
              </>
            ) : null
          ) : (
            <span className="pill muted">
              <span className="dot" /> {modulo.fonte}
            </span>
          )}
        </div>
      </header>

      <div className="messages">
        {messages.length === 0 && !loading && (
          <div className="empty">
            <div className="glyph" />
            <h2>{modulo.nome}</h2>
            {modulo.disponivel ? (
              <>
                <p>Faça uma pergunta em linguagem natural.</p>
                <div className="chips">
                  {modulo.sugestoes.map((s) => (
                    <button key={s} className="chip" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p>
                Este módulo ainda não tem fonte de dados ligada ({modulo.fonte}). Posso ajudar a
                pensar sobre o tema, mas ainda não consulto dados reais.
              </p>
            )}
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="row user">
              <div className="bubble user">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="row assistant">
              <span className="module-mark sm" data-mod={modulo.key} />
              <div className="card">
                <div className="md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </div>
              </div>
            </div>
          )
        )}

        {loading && (
          <div className="row assistant">
            <span className="module-mark sm" data-mod={modulo.key} />
            <div className="card">
              <div className="typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <div className="composer-inner">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow();
            }}
            onKeyDown={onKeyDown}
            placeholder={`Pergunte ao assistente de ${modulo.nome}…`}
            rows={1}
            disabled={loading}
          />
          <button
            className="send"
            onClick={() => send()}
            disabled={loading || !input.trim()}
            aria-label="Enviar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );

  // ---------------- Gestão/Contabilidade: ecrã dividido ----------------
  if (modulo.key === "gestao") {
    return (
      <div className="workspace">
        <DashboardGestao fonte={modulo.fonte} disponivel={modulo.disponivel} />
        <div className="chat-col">{chatContent}</div>
      </div>
    );
  }

  // ---------------- Comercial: ecrã dividido ----------------
  if (modulo.key === "comercial") {
    return (
      <div className="workspace">
        <DashboardComercial fonte={modulo.fonte} disponivel={modulo.disponivel} />
        <div className="chat-col">{chatContent}</div>
      </div>
    );
  }

  // ---------------- Outros módulos: só chat ----------------
  return <div className="page">{chatContent}</div>;
}
