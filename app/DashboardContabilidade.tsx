"use client";

import { useEffect, useState } from "react";

type ItemRank = { nome: string; total: number; pct: number };

type Metricas = {
  ligado: boolean;
  ano: number;
  moeda: string;
  base: string;
  meta_ano: number | null;
  vendas_ytd: number;
  meta_percent: number | null;
  projecao_ano: number;
  meses_atual: number[];
  meses_anterior: number[];
  ytd_atual: number;
  ytd_homologo: number;
  var_homologa: number | null;
  trimestres_atual: number[];
  trimestres_anterior: number[];
  num_clientes: number;
  total_vendas_ano: number;
  concentracao_top10: number | null;
  top_clientes: ItemRank[];
  vendas_por_comercial: ItemRank[];
  aging: {
    total_vencido: number;
    corrente: number;
    b1_30: number;
    b31_45: number;
    b46_60: number;
    b60_mais: number;
    por_comercial: Array<{ nome: string; corrente: number; b1_30: number; b31_45: number; b46_60: number; b60_mais: number; vencido: number }>;
  };
  dso: number | null;
  novos_clientes: { mes_label: string; total: number; metodo: string; por_comercial: Array<{ nome: string; novos: number }> };
  erosao: { periodo_label: string; homologo_label: string; clientes: Array<{ nome: string; atual: number; homologo: number; queda: number; variacao_pct: number | null }> };
  incompleto: boolean;
  erro?: string;
};

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const eur = (n: number) =>
  (n || 0).toLocaleString("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const eurC = (n: number) => {
  const v = n || 0;
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}M`;
  if (Math.abs(v) >= 1_000) return `€${Math.round(v / 1_000).toLocaleString("pt-PT")}k`;
  return `€${Math.round(v).toLocaleString("pt-PT")}`;
};

const pctSigned = (n: number | null) =>
  n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`;

const pctPlain = (n: number | null) =>
  n === null || n === undefined ? "—" : `${n.toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pot = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pot;
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return mult * pot;
}

function LineChart({ atual, anterior, ano }: { atual: number[]; anterior: number[]; ano: number }) {
  const W = 720;
  const H = 240;
  const padL = 52;
  const padR = 14;
  const padT = 18;
  const padB = 30;
  const max = niceMax(Math.max(1, ...atual, ...anterior));
  const x = (i: number) => padL + (i * (W - padL - padR)) / 11;
  const y = (v: number) => padT + (H - padT - padB) - (v / max) * (H - padT - padB);
  const linha = (arr: number[]) => arr.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Evolução mensal de vendas">
      {grid.map((g, i) => {
        const gy = padT + (H - padT - padB) * (1 - g);
        return (
          <g key={i}>
            <line x1={padL} y1={gy} x2={W - padR} y2={gy} className="grid-line" />
            <text x={padL - 8} y={gy + 3} className="axis-label" textAnchor="end">
              {eurC(max * g)}
            </text>
          </g>
        );
      })}
      {MESES.map((m, i) => (
        <text key={m} x={x(i)} y={H - 10} className="axis-label" textAnchor="middle">
          {m}
        </text>
      ))}
      <path d={linha(anterior)} className="line-prev" fill="none" />
      <path d={linha(atual)} className="line-cur" fill="none" />
      {atual.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r="3" className="dot-cur">
          <title>{`${MESES[i]} ${ano}: ${eur(v)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function QuarterBars({ atual, anterior, ano }: { atual: number[]; anterior: number[]; ano: number }) {
  const max = niceMax(Math.max(1, ...atual, ...anterior));
  return (
    <div className="qbars">
      {atual.map((v, i) => (
        <div className="qgroup" key={i}>
          <div className="qbar-pair">
            <div
              className="qbar prev"
              style={{ height: `${Math.max(2, (anterior[i] / max) * 100)}%` }}
              title={`T${i + 1} ${ano - 1}: ${eur(anterior[i])}`}
            />
            <div
              className="qbar cur"
              style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
              title={`T${i + 1} ${ano}: ${eur(v)}`}
            />
          </div>
          <span className="qbar-val">{eurC(v)}</span>
          <span className="qbar-lbl">T{i + 1}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardContabilidade() {
  const [m, setM] = useState<Metricas | null>(null);
  const [loading, setLoading] = useState(true);

  function carregar(forcar = false) {
    setLoading(true);
    fetch(`/api/gestao/metricas${forcar ? "?fresh=1" : ""}`)
      .then((r) => r.json())
      .then((d: Metricas) => setM(d))
      .catch(() => setM(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
  }, []);

  const ano = m?.ano ?? new Date().getFullYear();
  const ligado = m?.ligado ?? false;
  const metaPct = m?.meta_percent ?? null;
  const larguraBarra = Math.max(0, Math.min(100, metaPct ?? 0));

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h2 className="dash-title">Métricas</h2>
          <p className="dash-sub">Vendas · {ano} · sem IVA (volume de negócios)</p>
        </div>
        <button className="refresh" onClick={() => carregar(true)} aria-label="Atualizar" disabled={loading}>
          ↻
        </button>
      </div>

      {loading && <div className="hint">A carregar as métricas do Moloni…</div>}

      {!loading && !ligado && (
        <div className="hint">
          {m?.erro ? m.erro : "Ligue o Moloni para ver as métricas. Abra a ligação e volte a atualizar."}
        </div>
      )}

      {!loading && ligado && m && (
        <>
          {/* ---------- Objetivo ---------- */}
          <div className="goal-card">
            <div className="goal-top">
              <span className="goal-label">Objetivo de vendas {ano}</span>
              {m.incompleto && <span className="goal-flag">amostra parcial</span>}
            </div>
            <div className="goal-nums">
              <span className="goal-big">{eur(m.vendas_ytd)}</span>
              <span className="goal-of">de {m.meta_ano ? eur(m.meta_ano) : "meta por definir"}</span>
            </div>
            <div className="goal-bar">
              <div className="goal-fill" style={{ width: `${larguraBarra}%` }} />
            </div>
            <div className="goal-foot">
              <div>
                <span className="gf-num">{pctPlain(metaPct)}</span>
                <span className="gf-lbl">da meta</span>
              </div>
              <div>
                <span className="gf-num">{eurC(m.projecao_ano)}</span>
                <span className="gf-lbl">projeção anual</span>
              </div>
              <div>
                <span className={`gf-num ${(m.var_homologa ?? 0) > 0 ? "up" : (m.var_homologa ?? 0) < 0 ? "down" : ""}`}>
                  {pctSigned(m.var_homologa)}
                </span>
                <span className="gf-lbl">vs {ano - 1}</span>
              </div>
            </div>
          </div>

          {/* ---------- Evolução mensal (homólogo) ---------- */}
          <div className="chart-card">
            <div className="chart-head">
              <span className="chart-title">Evolução mensal</span>
              <span className="legend">
                <i className="lg cur" />
                {ano}
                <i className="lg prev" />
                {ano - 1}
              </span>
            </div>
            <LineChart atual={m.meses_atual} anterior={m.meses_anterior} ano={ano} />
            <div className="chart-foot">
              <span>
                Acumulado {ano}: <strong>{eur(m.ytd_atual)}</strong>
              </span>
              <span>
                Mesmo período {ano - 1}: <strong>{eur(m.ytd_homologo)}</strong>
              </span>
            </div>
          </div>

          {/* ---------- Trimestres ---------- */}
          <div className="chart-card">
            <div className="chart-head">
              <span className="chart-title">Vendas por trimestre</span>
              <span className="legend">
                <i className="lg cur" />
                {ano}
                <i className="lg prev" />
                {ano - 1}
              </span>
            </div>
            <QuarterBars atual={m.trimestres_atual} anterior={m.trimestres_anterior} ano={ano} />
          </div>

          {/* ---------- Concentração de clientes ---------- */}
          <div className="rank-card">
            <div className="rank-head">
              <span className="chart-title">Concentração de clientes</span>
              <span className="rank-hl">
                Top 10 = <strong>{pctPlain(m.concentracao_top10)}</strong> das vendas
              </span>
            </div>
            <div className="rank-list">
              {m.top_clientes.length === 0 ? (
                <div className="rank-empty">Sem dados de clientes.</div>
              ) : (
                m.top_clientes.map((c, i) => (
                  <div className="rank-row" key={i}>
                    <span className="rank-pos">{i + 1}</span>
                    <div className="rank-main">
                      <div className="rank-line">
                        <span className="rank-name" title={c.nome}>
                          {c.nome}
                        </span>
                        <span className="rank-val">{eur(c.total)}</span>
                      </div>
                      <div className="rank-track">
                        <div className="rank-bar" style={{ width: `${Math.max(2, c.pct)}%` }} />
                      </div>
                    </div>
                    <span className="rank-pct">{pctPlain(c.pct)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ---------- Vendas por comercial ---------- */}
          <div className="rank-card">
            <div className="rank-head">
              <span className="chart-title">Vendas por comercial</span>
              <span className="rank-sub">{ano}</span>
            </div>
            <div className="rank-list">
              {m.vendas_por_comercial.length === 0 ? (
                <div className="rank-empty">Sem dados de comerciais.</div>
              ) : (
                m.vendas_por_comercial.map((c, i) => (
                  <div className="rank-row" key={i}>
                    <span className="rank-pos alt">{i + 1}</span>
                    <div className="rank-main">
                      <div className="rank-line">
                        <span className="rank-name">{c.nome}</span>
                        <span className="rank-val">{eur(c.total)}</span>
                      </div>
                      <div className="rank-track">
                        <div className="rank-bar alt" style={{ width: `${Math.max(2, c.pct)}%` }} />
                      </div>
                    </div>
                    <span className="rank-pct">{pctPlain(c.pct)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ---------- DSO ---------- */}
          <div className="kpi-card">
            <div className="kpi-main">
              <span className="kpi-num">{m.dso != null ? `${m.dso} dias` : "—"}</span>
              <span className="kpi-lbl">DSO · prazo médio de recebimento</span>
            </div>
            <p className="kpi-note">
              Tempo médio estimado entre faturar e receber (saldo por receber ÷ vendas dos últimos 12 meses).
            </p>
          </div>

          {/* ---------- Aging ---------- */}
          <div className="rank-card">
            <div className="rank-head">
              <span className="chart-title">Saldo vencido (aging)</span>
              <span className="rank-hl">
                Total vencido <strong>{eur(m.aging.total_vencido)}</strong>
              </span>
            </div>
            <div className="aging-buckets">
              <div className="abk"><span className="abk-v b1">{eurC(m.aging.b1_30)}</span><span className="abk-l">1–30 d</span></div>
              <div className="abk"><span className="abk-v b2">{eurC(m.aging.b31_45)}</span><span className="abk-l">31–45 d</span></div>
              <div className="abk"><span className="abk-v b3">{eurC(m.aging.b46_60)}</span><span className="abk-l">46–60 d</span></div>
              <div className="abk"><span className="abk-v b4">{eurC(m.aging.b60_mais)}</span><span className="abk-l">+60 d</span></div>
            </div>
            <div className="rank-list">
              {m.aging.por_comercial.length === 0 ? (
                <div className="rank-empty">Sem saldos em dívida. 🎉</div>
              ) : (
                m.aging.por_comercial.map((c, i) => {
                  const maxV = Math.max(1, ...m.aging.por_comercial.map((x) => x.vencido));
                  const seg = (val: number) => (c.vencido > 0 ? (val / c.vencido) * 100 : 0);
                  return (
                    <div className="rank-row" key={i}>
                      <div className="rank-main">
                        <div className="rank-line">
                          <span className="rank-name">{c.nome}</span>
                          <span className="rank-val">{eur(c.vencido)}</span>
                        </div>
                        <div className="rank-track">
                          <div className="aging-bar" style={{ width: `${Math.max(2, (c.vencido / maxV) * 100)}%` }}>
                            <span className="seg b1" style={{ width: `${seg(c.b1_30)}%` }} />
                            <span className="seg b2" style={{ width: `${seg(c.b31_45)}%` }} />
                            <span className="seg b3" style={{ width: `${seg(c.b46_60)}%` }} />
                            <span className="seg b4" style={{ width: `${seg(c.b60_mais)}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ---------- Novos clientes ---------- */}
          <div className="rank-card">
            <div className="rank-head">
              <span className="chart-title">Novos clientes</span>
              <span className="rank-sub">{m.novos_clientes.mes_label}</span>
            </div>
            <div className="novos-total">
              <strong>{m.novos_clientes.total}</strong> novos clientes este mês
            </div>
            <div className="rank-list">
              {m.novos_clientes.por_comercial.length === 0 ? (
                <div className="rank-empty">Sem novos clientes registados este mês.</div>
              ) : (
                m.novos_clientes.por_comercial.map((c, i) => (
                  <div className="nc-row" key={i}>
                    <span className="nc-name">{c.nome}</span>
                    <span className="nc-count">{c.novos}</span>
                  </div>
                ))
              )}
            </div>
            <p className="kpi-note">Base: {m.novos_clientes.metodo}.</p>
          </div>

          {/* ---------- Alerta de erosão ---------- */}
          <div className="rank-card">
            <div className="rank-head">
              <span className="chart-title">Alerta quebra de vendas</span>
              <span className="rank-sub">
                {m.erosao.periodo_label} vs {m.erosao.homologo_label}
              </span>
            </div>
            <div className="rank-list">
              {m.erosao.clientes.length === 0 ? (
                <div className="rank-empty">Sem quedas relevantes face ao homólogo. 🎉</div>
              ) : (
                m.erosao.clientes.map((c, i) => (
                  <div className="ero-row" key={i}>
                    <div className="ero-main">
                      <span className="rank-name">{c.nome}</span>
                      <span className="ero-flow">
                        {eurC(c.homologo)} → {eurC(c.atual)}
                      </span>
                    </div>
                    <span className="ero-var down">{c.variacao_pct != null ? `${c.variacao_pct}%` : "—"}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
