"use client";

import { useEffect, useRef, useState } from "react";

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

type MargemItem = { nome: string; venda: number; custo: number; margem: number; margem_pct: number | null };
type ResultadoMargem = {
  ligado: boolean;
  ano: number;
  base: string;
  regra_custo: string;
  venda_total: number;
  custo_total: number;
  margem_total: number;
  margem_pct: number | null;
  venda_sem_custo: number;
  meses: Array<{ mes: number; venda: number; custo: number; margem: number; margem_pct: number | null }>;
  por_cliente: MargemItem[];
  por_referencia: MargemItem[];
  n_documentos: number;
  incompleto: boolean;
  calculado_em: number;
};

type CicloCaixa = {
  ligado: boolean;
  ano: number;
  valor_stock: number;
  compras_ano: number;
  contas_a_pagar: number;
  cogs: number | null;
  dso: number | null;
  dio: number | null;
  dpo: number | null;
  ccc: number | null;
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

const classeMargem = (p: number | null) =>
  p === null || p === undefined ? "" : p < 0 ? "neg" : p < 20 ? "low" : p < 35 ? "mid" : "good";

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

function MargemBars({ meses }: { meses: Array<{ mes: number; margem: number; margem_pct: number | null }> }) {
  const max = niceMax(Math.max(1, ...meses.map((m) => Math.abs(m.margem))));
  return (
    <div className="bars">
      {meses.map((m, i) => (
        <div className="bargroup" key={i} title={`${MESES[i]}: ${eur(m.margem)} · ${pctPlain(m.margem_pct)}`}>
          <div className="barpair">
            <div className="bar rec" style={{ height: `${Math.max(2, (Math.abs(m.margem) / max) * 100)}%` }} />
          </div>
          <span className="mbar-pct">{m.margem !== 0 && m.margem_pct != null ? `${Math.round(m.margem_pct)}%` : ""}</span>
          <span className="barlbl">{MESES[i]}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardContabilidade() {
  const [m, setM] = useState<Metricas | null>(null);
  const [loading, setLoading] = useState(true);
  const [margem, setMargem] = useState<{ estado: string; data: ResultadoMargem | null } | null>(null);
  const margemTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ciclo, setCiclo] = useState<CicloCaixa | null>(null);

  function carregar(forcar = false) {
    setLoading(true);
    fetch(`/api/gestao/metricas${forcar ? "?fresh=1" : ""}`)
      .then((r) => r.json())
      .then((d: Metricas) => setM(d))
      .catch(() => setM(null))
      .finally(() => setLoading(false));
  }

  function carregarMargem(forcar = false) {
    fetch(`/api/gestao/margem${forcar ? "?fresh=1" : ""}`)
      .then((r) => r.json())
      .then((d: { estado: string; data: ResultadoMargem | null }) => {
        setMargem(d);
        if (d.estado === "a_calcular") {
          if (margemTimer.current) clearTimeout(margemTimer.current);
          margemTimer.current = setTimeout(() => carregarMargem(false), 25000);
        }
        if (d.estado === "pronto") carregarCiclo(true);
      })
      .catch(() => {});
  }

  function carregarCiclo(forcar = false) {
    fetch(`/api/gestao/ciclo${forcar ? "?fresh=1" : ""}`)
      .then((r) => r.json())
      .then((d: CicloCaixa) => setCiclo(d))
      .catch(() => {});
  }

  useEffect(() => {
    carregar();
    carregarMargem();
    carregarCiclo();
    return () => {
      if (margemTimer.current) clearTimeout(margemTimer.current);
    };
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
            <p className="card-legenda">
              Total já vendido este ano (sem IVA) face à meta anual. Em baixo: percentagem da meta atingida, projeção de fecho do ano ao ritmo atual, e comparação com o mesmo período do ano anterior.
            </p>
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
            <p className="card-legenda">
              Vendas de cada mês (sem IVA). Linha cheia = este ano; linha tracejada = ano anterior. Em baixo, o acumulado de cada ano no mesmo período.
            </p>
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
            <p className="card-legenda">
              Total de vendas por trimestre (sem IVA). Barra escura = este ano; barra clara = ano anterior.
            </p>
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
            <p className="card-legenda">
              Peso de cada cliente nas vendas do ano. "Top 10 = X%" indica quanto os 10 maiores representam do total — quanto mais alto, maior a dependência de poucos clientes.
            </p>
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
            <p className="card-legenda">
              Total vendido por cada comercial este ano (sem IVA) e o seu peso no total.
            </p>
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
              DSO = prazo médio de recebimento: quantos dias, em média, os clientes demoram a pagar depois de faturados. Quanto mais baixo, melhor para a tesouraria.
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
            <p className="card-legenda">
              Dinheiro já vencido (que devia ter sido recebido), agrupado por tempo de atraso. Em baixo, o total em dívida por comercial — o vermelho (+60 dias) é o mais preocupante.
            </p>
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
            <p className="card-legenda">
              Clientes angariados no mês atual, repartidos por comercial.
            </p>
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
            <p className="card-legenda">
              Clientes que venderam menos neste trimestre face ao mesmo trimestre do ano anterior. Mostra a evolução (ano anterior → este ano) e a variação em percentagem.
            </p>
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

          {/* ================= MARGEM (Fase B) ================= */}
          {margem && margem.estado === "a_calcular" && !margem.data ? (
            <div className="margin-calc">
              <span className="spinner" />
              <div>
                <strong>A calcular a margem…</strong>
                <p>A ler as linhas de todas as faturas do ano. Demora ~3 minutos na primeira vez — esta secção atualiza-se sozinha.</p>
              </div>
            </div>
          ) : margem && margem.data ? (
            <>
              {margem.estado === "a_atualizar" && (
                <div className="margin-updating">A atualizar a margem em segundo plano…</div>
              )}

              <div className="goal-card">
                <div className="goal-top">
                  <span className="goal-label">Margem bruta {margem.data.ano}</span>
                  <span className="goal-flag">custo: {margem.data.regra_custo}</span>
                </div>
                <p className="card-legenda">
                  Quanto sobra depois de tirar o custo dos produtos vendidos (sem IVA). "% de margem" = (vendas − custo) ÷ vendas. "Vendas c/ custo" é a base do cálculo; "vendas s/ custo" (ex.: serviços, sem custo no Moloni) ficam de fora.
                </p>
                <div className="goal-nums">
                  <span className={`goal-big ${classeMargem(margem.data.margem_pct)}`}>{pctPlain(margem.data.margem_pct)}</span>
                  <span className="goal-of">de margem · sem IVA</span>
                </div>
                <div className="goal-foot">
                  <div><span className="gf-num">{eurC(margem.data.margem_total)}</span><span className="gf-lbl">margem (€)</span></div>
                  <div><span className="gf-num">{eurC(margem.data.venda_total)}</span><span className="gf-lbl">vendas c/ custo</span></div>
                  <div><span className="gf-num">{eurC(margem.data.venda_sem_custo)}</span><span className="gf-lbl">vendas s/ custo</span></div>
                </div>
              </div>

              <div className="chart-card">
                <div className="chart-head"><span className="chart-title">Margem por mês</span></div>
                <p className="card-legenda">Euros de margem gerados em cada mês (sem IVA). A percentagem por cima de cada barra é a margem desse mês.</p>
                <MargemBars meses={margem.data.meses} />
              </div>

              <div className="rank-card">
                <div className="rank-head">
                  <span className="chart-title">Margem por cliente</span>
                  <span className="rank-sub">top 20 · {margem.data.ano}</span>
                </div>
                <p className="card-legenda">
                  Os 20 maiores clientes por vendas e a margem de cada um. Vermelho = margem negativa; laranja = margem baixa (menos de 20%).
                </p>
                <div className="rank-list">
                  {margem.data.por_cliente.map((c, i) => (
                    <div className="mg-row" key={i}>
                      <span className="rank-pos">{i + 1}</span>
                      <span className="mg-name" title={c.nome}>{c.nome}</span>
                      <span className="mg-venda">{eur(c.venda)}</span>
                      <span className={`mg-pct ${classeMargem(c.margem_pct)}`}>{pctPlain(c.margem_pct)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rank-card">
                <div className="rank-head">
                  <span className="chart-title">Margem por referência</span>
                  <span className="rank-sub">top 20 · {margem.data.ano}</span>
                </div>
                <p className="card-legenda">
                  Os 20 produtos com mais vendas e a margem de cada um — para ver que artigos dão (ou tiram) margem.
                </p>
                <div className="rank-list">
                  {margem.data.por_referencia.map((c, i) => (
                    <div className="mg-row" key={i}>
                      <span className="rank-pos alt">{i + 1}</span>
                      <span className="mg-name" title={c.nome}>{c.nome}</span>
                      <span className="mg-venda">{eur(c.venda)}</span>
                      <span className={`mg-pct ${classeMargem(c.margem_pct)}`}>{pctPlain(c.margem_pct)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}

              {ciclo && ciclo.ligado && (
                <div className="rank-card">
                  <div className="rank-head">
                    <span className="chart-title">Ciclo de conversão de caixa</span>
                    <span className="rank-sub">{ciclo.ano}</span>
                  </div>
                  <p className="card-legenda">
                    Quantos dias o dinheiro fica "preso" na operação: desde que se compra até se receber do cliente. CCC = DSO + DIO − DPO. Quanto mais baixo, melhor.
                  </p>
                  <div className="ccc-grid">
                    <div className="ccc-box">
                      <span className="ccc-num">{ciclo.dso != null ? ciclo.dso : "—"}</span>
                      <span className="ccc-lbl">DSO · recebimento</span>
                    </div>
                    <div className="ccc-box">
                      <span className="ccc-num">{ciclo.dio != null ? ciclo.dio : "—"}</span>
                      <span className="ccc-lbl">DIO · stock</span>
                    </div>
                    <div className="ccc-box">
                      <span className="ccc-num">{ciclo.dpo != null ? ciclo.dpo : "—"}</span>
                      <span className="ccc-lbl">DPO · pagamento</span>
                    </div>
                    <div className="ccc-box ccc-total">
                      <span className="ccc-num">{ciclo.ccc != null ? ciclo.ccc : "—"}</span>
                      <span className="ccc-lbl">CCC · ciclo (dias)</span>
                    </div>
                  </div>
                  <div className="ccc-detalhe">
                    Stock em armazém: <strong>{eur(ciclo.valor_stock)}</strong> · Compras {ciclo.ano}: <strong>{eur(ciclo.compras_ano)}</strong> · Por pagar a fornecedores: <strong>{eur(ciclo.contas_a_pagar)}</strong> · Custo dos produtos vendidos: <strong>{ciclo.cogs != null ? eur(ciclo.cogs) : "—"}</strong>
                  </div>
                  {(ciclo.dio == null || ciclo.ccc == null) && (
                    <p className="card-legenda" style={{ marginTop: 8 }}>
                      O DIO e o CCC precisam do custo dos produtos vendidos (vem do cálculo da margem). Se a margem ainda está a calcular, aparecem assim que estiver pronta — ou carrega em ↻.
                    </p>
                  )}
                  <p className="card-legenda" style={{ marginTop: 8 }}>
                    Nota: o DPO e o CCC dependem de as compras estarem lançadas no Moloni de forma completa. Se houver compras por registar, estes valores podem não refletir a realidade.
                  </p>
                </div>
              )}
        </>
      )}
    </div>
  );
}
