"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = { role: "user" | "assistant"; content: string };

type Props = {
  modulo: string;
  nome: string;
  integracao: string;
  ativo: boolean;
  sugestoes: string[];
};

export default function ChatModulo({ modulo, nome, integracao, ativo, sugestoes }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tocLigado, setTocLigado] = useState<boolean | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const mostraToc = modulo === "gestao" && integracao === "TOC Online";

  useEffect(() => {
    if (!mostraToc) return;
    fetch("/api/toconline/status")
      .then((r) => r.json())
      .then((d) => setTocLigado(Boolean(d.ligado)))
      .catch(() => setTocLigado(null));
  }, [mostraToc]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function autoGrow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }

  async function send(texto?: string) {
    const text = (texto ?? input).trim();
    if (!text || loading) return;

    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, modulo }),
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

  return (
    <div className="page">
      <header className="header">
        <a className="back" href="/">← Módulos</a>
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <h1>{nome}</h1>
            <p className="sub">Assistente do departamento de {nome.toLowerCase()}.</p>
          </div>
        </div>
        <div className="toc-bar">
          {mostraToc ? (
            <>
              {tocLigado === true && (
                <span className="pill on">
                  <span className="dot" /> TOC Online ligado
                </span>
              )}
              {tocLigado === false && (
                <>
                  <span className="pill off">
                    <span className="dot" /> TOC Online por ligar
                  </span>
                  <a className="toc-link" href="/api/toconline/connect">
                    Ligar TOC Online
                  </a>
                </>
              )}
            </>
          ) : (
            <span className="pill muted">
              <span className="dot" /> Integração: {integracao}
            </span>
          )}
        </div>
      </header>

      <div className="messages">
        {messages.length === 0 && !loading && (
          <div className="empty">
            <div className="glyph" />
            {ativo ? (
              <>
                <h2>Em que posso ajudar?</h2>
                <p>Faça uma pergunta sobre {nome.toLowerCase()}, em linguagem natural.</p>
                <div className="chips">
                  {sugestoes.map((s) => (
                    <button key={s} className="chip" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <h2>Módulo em preparação</h2>
                <p>
                  Este módulo ainda não tem integração de dados ligada ({integracao}). Pode
                  conversar, mas as consultas a dados reais serão possíveis assim que a ligação
                  estiver definida.
                </p>
              </>
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
              <div className="avatar" />
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
            <div className="avatar" />
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
            placeholder="Escreva a sua pergunta…"
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
    </div>
  );
}
