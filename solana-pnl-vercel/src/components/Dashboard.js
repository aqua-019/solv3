"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import * as d3 from "d3";
import {
  AQUATIC_WALLET,
  HELIUS_KEY,
  fmt,
  fUsd,
  sAddr,
  pCol,
} from "@/lib/config";
import {
  getSolBalance,
  getTokenAccounts,
  dexTokens,
  dexPairs,
  getSolPrice,
  fetchSwaps,
  fetchTransfers,
  buildCostBasis,
  enrichTokens,
  buildSnapshot,
} from "@/lib/api";

// ─── Noise Texture ──────────────────────────────────
function mkNoise(w = 200, h = 200, op = 0.025) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d"),
    im = ctx.createImageData(w, h);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = Math.random() * 255;
    im.data[i] = v;
    im.data[i + 1] = v;
    im.data[i + 2] = v;
    im.data[i + 3] = op * 255;
  }
  ctx.putImageData(im, 0, 0);
  return c.toDataURL();
}

// ─── D3 Pie Chart ───────────────────────────────────
function Pie({ data, size = 260 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !data?.length) return;
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    const r = size / 2 - 8;
    const g = svg
      .append("g")
      .attr("transform", `translate(${size / 2},${size / 2})`);
    const cols = [
      "#9945ff", "#00ff88", "#ff4466", "#ffaa00", "#14f195",
      "#7799ee", "#ff6688", "#44ddff", "#ff9944", "#aa66ff",
    ];
    const col = d3.scaleOrdinal(cols);
    const pie = d3.pie().value((d) => d.value).sort(null).padAngle(0.02);
    const arc = d3.arc().innerRadius(r * 0.58).outerRadius(r);
    const arcH = d3.arc().innerRadius(r * 0.55).outerRadius(r + 5);

    g.selectAll("path")
      .data(pie(data))
      .enter()
      .append("path")
      .attr("d", arc)
      .attr("fill", (_, i) => col(i))
      .attr("stroke", "#0a1220")
      .attr("stroke-width", 2)
      .style("opacity", 0.85)
      .style("cursor", "pointer")
      .on("mouseenter", function (ev, d) {
        d3.select(this).transition().duration(120).attr("d", arcH).style("opacity", 1);
        tt.style("display", "block").html(
          `<b>${d.data.label}</b><br/>${fUsd(d.data.value)}<br/>${d.data.pct.toFixed(1)}%`
        );
      })
      .on("mousemove", function (ev) {
        const [x, y] = d3.pointer(ev, ref.current);
        tt.style("left", x + 12 + "px").style("top", y - 8 + "px");
      })
      .on("mouseleave", function () {
        d3.select(this).transition().duration(120).attr("d", arc).style("opacity", 0.85);
        tt.style("display", "none");
      });

    g.append("text").attr("text-anchor", "middle").attr("dy", "-0.2em")
      .attr("fill", "#667788").attr("font-size", 9).attr("font-weight", 700)
      .attr("letter-spacing", 1.5).text("ALLOCATION");
    g.append("text").attr("text-anchor", "middle").attr("dy", "1.3em")
      .attr("fill", "#e8edf5").attr("font-size", 15).attr("font-weight", 900)
      .text(fUsd(data.reduce((s, d) => s + d.value, 0)));

    const tt = d3
      .select(ref.current.parentNode)
      .append("div")
      .style("position", "absolute")
      .style("display", "none")
      .style("background", "rgba(8,14,25,0.95)")
      .style("border", "1px solid rgba(255,255,255,0.1)")
      .style("border-radius", "8px")
      .style("padding", "7px 11px")
      .style("font-size", "11px")
      .style("color", "#c8d0e0")
      .style("pointer-events", "none")
      .style("z-index", 10)
      .style("box-shadow", "0 6px 20px rgba(0,0,0,0.5)");
    return () => tt.remove();
  }, [data, size]);
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <svg ref={ref} width={size} height={size} />
    </div>
  );
}

// ─── Sparkline ──────────────────────────────────────
function Spark({ data, color, w = 100, h = 28 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !data?.length) return;
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    const x = d3.scaleLinear().domain([0, data.length - 1]).range([0, w]);
    const y = d3.scaleLinear()
      .domain([d3.min(data) * 0.97, d3.max(data) * 1.03])
      .range([h - 1, 1]);
    const gId = "s" + Math.random().toString(36).slice(2, 8);
    const defs = svg.append("defs");
    const gr = defs.append("linearGradient").attr("id", gId).attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 1);
    gr.append("stop").attr("offset", "0%").attr("stop-color", color).attr("stop-opacity", 0.3);
    gr.append("stop").attr("offset", "100%").attr("stop-color", color).attr("stop-opacity", 0);
    svg.append("path").datum(data)
      .attr("d", d3.area().x((_, i) => x(i)).y0(h).y1((d) => y(d)).curve(d3.curveMonotoneX))
      .attr("fill", `url(#${gId})`);
    svg.append("path").datum(data)
      .attr("d", d3.line().x((_, i) => x(i)).y((d) => y(d)).curve(d3.curveMonotoneX))
      .attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.5);
  }, [data, color, w, h]);
  return <svg ref={ref} width={w} height={h} />;
}

// ─── Detail Chart ───────────────────────────────────
function DetailChart({ pairs }) {
  const ref = useRef(null);
  const [tf, setTf] = useState("h24");
  const mp = pairs?.[0];
  useEffect(() => {
    if (!ref.current || !mp) return;
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    const W = ref.current.clientWidth || 580, H = 240;
    const M = { t: 16, r: 48, b: 24, l: 56 };
    const price = parseFloat(mp.priceUsd || 0);
    const pct = mp.priceChange?.[tf] || 0;
    const N = tf === "m5" ? 30 : tf === "h1" ? 60 : tf === "h6" ? 72 : 96;
    const s = price / (1 + pct / 100);
    const pts = Array.from({ length: N }, (_, i) => {
      const t = i / (N - 1), v = s + (price - s) * t;
      return { i, p: Math.max(0, v + v * (Math.random() - 0.5) * 0.035) };
    });
    const x = d3.scaleLinear().domain([0, N - 1]).range([M.l, W - M.r]);
    const ext = d3.extent(pts, (d) => d.p);
    const pad = (ext[1] - ext[0]) * 0.12 || ext[0] * 0.12;
    const y = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).range([H - M.b, M.t]);
    const lc = pct >= 0 ? "#00ff88" : "#ff4466";
    y.ticks(5).forEach((t) => {
      svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(t)).attr("y2", y(t)).attr("stroke", "#141e2e");
      svg.append("text").attr("x", M.l - 6).attr("y", y(t) + 3).attr("text-anchor", "end").attr("fill", "#445566").attr("font-size", 9)
        .text("$" + (t < 0.001 ? t.toExponential(1) : fmt(t, t < 1 ? 6 : 2)));
    });
    const gId = "c" + Math.random().toString(36).slice(2, 8);
    const defs = svg.append("defs");
    const gr = defs.append("linearGradient").attr("id", gId).attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 1);
    gr.append("stop").attr("offset", "0%").attr("stop-color", lc).attr("stop-opacity", 0.2);
    gr.append("stop").attr("offset", "100%").attr("stop-color", lc).attr("stop-opacity", 0);
    svg.append("path").datum(pts)
      .attr("d", d3.area().x((d) => x(d.i)).y0(H - M.b).y1((d) => y(d.p)).curve(d3.curveMonotoneX))
      .attr("fill", `url(#${gId})`);
    svg.append("path").datum(pts)
      .attr("d", d3.line().x((d) => x(d.i)).y((d) => y(d.p)).curve(d3.curveMonotoneX))
      .attr("fill", "none").attr("stroke", lc).attr("stroke-width", 2);
    const last = pts[pts.length - 1];
    svg.append("circle").attr("cx", x(last.i)).attr("cy", y(last.p)).attr("r", 3.5).attr("fill", lc);
    svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(price)).attr("y2", y(price))
      .attr("stroke", lc).attr("stroke-dasharray", "3,3").attr("opacity", 0.4);
    svg.append("text").attr("x", W - M.r + 4).attr("y", y(price) + 3).attr("fill", lc).attr("font-size", 10).attr("font-weight", 700)
      .text("$" + (price < 0.001 ? price.toExponential(2) : fmt(price, price < 1 ? 6 : 2)));
  }, [mp, tf]);

  return (
    <div>
      <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
        {["m5", "h1", "h6", "h24"].map((t) => (
          <button key={t} onClick={() => setTf(t)} style={{
            background: tf === t ? "rgba(0,255,136,0.12)" : "rgba(255,255,255,0.025)",
            border: `1px solid ${tf === t ? "#00ff8855" : "rgba(255,255,255,0.06)"}`,
            color: tf === t ? "#00ff88" : "#556677", padding: "3px 10px", borderRadius: 5,
            fontSize: 10, fontWeight: 700, cursor: "pointer", textTransform: "uppercase", letterSpacing: 1,
          }}>{t}</button>
        ))}
      </div>
      <svg ref={ref} width="100%" height={240} style={{ overflow: "visible" }} />
    </div>
  );
}

// ─── Token Detail Modal ─────────────────────────────
function TokenModal({ token, cb, solPrice, onClose }) {
  const [pairs, setPairs] = useState([]);
  const [ld, setLd] = useState(true);
  useEffect(() => {
    if (token) { setLd(true); dexPairs(token.mint).then((p) => { setPairs(p); setLd(false); }); }
  }, [token]);
  if (!token) return null;
  const mp = pairs[0];
  const price = mp ? parseFloat(mp.priceUsd || 0) : token.priceUsd || 0;
  const pNat = mp ? parseFloat(mp.priceNative || 0) : 0;
  const c = cb?.[token.mint];
  const valUsd = token.balance * price;
  const valSol = pNat ? token.balance * pNat : 0;
  const avgBuySol = c?.bought > 0 ? c.solSpent / c.bought : 0;
  const costBasisSol = c ? (token.balance / (c.bought || 1)) * c.solSpent : 0;
  const unrealizedSol = valSol - costBasisSol;
  const realizedSol = c ? c.solReceived - ((c.sold / (c.bought || 1)) * c.solSpent) : 0;
  const totalPnlSol = unrealizedSol + realizedSol;
  const totalPnlUsd = totalPnlSol * (solPrice || 0);

  const Stat = ({ l, v, cl }) => (
    <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "9px 11px" }}>
      <div style={{ fontSize: 8, color: "#556677", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700, marginBottom: 2 }}>{l}</div>
      <div style={{ fontSize: 13, fontWeight: 800, color: cl || "#c8d0e0", fontFeatureSettings: "'tnum'" }}>{v}</div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(20px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "linear-gradient(165deg, #0a1220, #0d1a2a 50%, #0a1018)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "auto", boxShadow: "0 40px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)", animation: "fadeIn 0.2s ease" }}>
        <div style={{ padding: "22px 26px 0", display: "flex", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {token.imageUrl && <img src={token.imageUrl} alt="" style={{ width: 36, height: 36, borderRadius: 9, border: "1px solid rgba(255,255,255,0.08)" }} onError={(e) => { e.target.style.display = "none"; }} />}
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#e8edf5" }}>{token.symbol || "Unknown"}</h2>
              <div style={{ fontSize: 10, color: "#445566", fontFamily: "monospace" }}>{token.mint}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "#667788", width: 32, height: 32, borderRadius: 8, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>

        {c && (
          <div style={{ margin: "14px 26px", padding: "14px 18px", borderRadius: 12, background: totalPnlSol >= 0 ? "linear-gradient(135deg, rgba(0,255,136,0.06), rgba(153,69,255,0.04))" : "linear-gradient(135deg, rgba(255,68,102,0.06), rgba(153,69,255,0.04))", border: `1px solid ${totalPnlSol >= 0 ? "rgba(0,255,136,0.12)" : "rgba(255,68,102,0.12)"}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 9, color: "#9977cc", textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700 }}>Helius Cost-Basis PnL</span>
              <span style={{ fontSize: 18, fontWeight: 900, color: pCol(totalPnlSol) }}>{totalPnlSol >= 0 ? "+" : ""}{fmt(totalPnlSol, 4)} SOL</span>
              <span style={{ fontSize: 12, color: "#667788" }}>({totalPnlUsd >= 0 ? "+" : ""}{fUsd(totalPnlUsd)})</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
              <Stat l="SOL Spent" v={fmt(c.solSpent, 4) + " SOL"} cl="#ff4466" />
              <Stat l="SOL Received" v={fmt(c.solReceived, 4) + " SOL"} cl="#00ff88" />
              <Stat l="Bought" v={fmt(c.bought, 2)} cl="#ffaa00" />
              <Stat l="Sold" v={fmt(c.sold, 2)} cl="#7799ee" />
              <Stat l="# Buys" v={c.trades.filter((t) => t.type === "BUY").length} cl="#00ff88" />
              <Stat l="# Sells" v={c.trades.filter((t) => t.type === "SELL").length} cl="#ff4466" />
              <Stat l="Avg Buy (SOL)" v={avgBuySol > 0 ? avgBuySol.toExponential(3) : "—"} cl="#ffaa00" />
              <Stat l="Unrealized" v={(unrealizedSol >= 0 ? "+" : "") + fmt(unrealizedSol, 4) + " SOL"} cl={pCol(unrealizedSol)} />
              <Stat l="Realized" v={(realizedSol >= 0 ? "+" : "") + fmt(realizedSol, 4) + " SOL"} cl={pCol(realizedSol)} />
            </div>
            {c.trades.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 9, color: "#556677", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700, marginBottom: 6 }}>Trade History</div>
                <div style={{ maxHeight: 130, overflow: "auto" }}>
                  {c.trades.slice(0, 30).map((t, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.02)", fontSize: 10, alignItems: "center" }}>
                      <span style={{ color: t.type === "BUY" ? "#00ff88" : "#ff4466", fontWeight: 800, width: 30 }}>{t.type}</span>
                      <span style={{ color: "#8899aa" }}>{fmt(t.amount, 2)} tkn</span>
                      <span style={{ color: "#556677" }}>→</span>
                      <span style={{ color: "#c8d0e0" }}>{fmt(t.sol, 4)} SOL</span>
                      <span style={{ color: "#445566", marginLeft: "auto", fontFamily: "monospace", fontSize: 9 }}>
                        {t.ts ? new Date(t.ts * 1000).toLocaleDateString() : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ padding: "10px 26px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
          {[
            { l: "Price", v: price < 0.001 ? "$" + price.toExponential(2) : fUsd(price) },
            { l: "Holdings", v: fmt(token.balance, token.balance < 1 ? 4 : 2) },
            { l: "Value (USD)", v: fUsd(valUsd), c: "#00ff88" },
            { l: "Value (SOL)", v: fmt(valSol, 4) + " SOL", c: "#9945ff" },
            { l: "24h Vol", v: fUsd(mp?.volume?.h24 || 0) },
            { l: "Liquidity", v: fUsd(mp?.liquidity?.usd || 0) },
            { l: "MCap", v: fUsd(mp?.marketCap || mp?.fdv || 0) },
            { l: "24h Buys", v: mp?.txns?.h24?.buys || "—", c: "#00ff88" },
            { l: "24h Sells", v: mp?.txns?.h24?.sells || "—", c: "#ff4466" },
          ].map((s, i) => (
            <div key={i} style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 8, color: "#556677", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700, marginBottom: 3 }}>{s.l}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: s.c || "#c8d0e0" }}>{s.v}</div>
            </div>
          ))}
        </div>

        <div style={{ padding: "8px 26px 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["m5", "h1", "h6", "h24"].map((t) => {
            const v = mp?.priceChange?.[t];
            if (v == null) return null;
            return (
              <div key={t} style={{ background: v >= 0 ? "rgba(0,255,136,0.05)" : "rgba(255,68,102,0.05)", border: `1px solid ${v >= 0 ? "rgba(0,255,136,0.12)" : "rgba(255,68,102,0.12)"}`, borderRadius: 7, padding: "5px 10px", fontSize: 11 }}>
                <span style={{ color: "#556677", marginRight: 5, fontWeight: 700 }}>{t.toUpperCase()}</span>
                <span style={{ color: pCol(v), fontWeight: 800 }}>{v >= 0 ? "+" : ""}{fmt(v, 2)}%</span>
              </div>
            );
          })}
        </div>

        <div style={{ padding: "0 26px 18px" }}>
          {ld ? <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "#334455" }}>Loading…</div>
            : mp ? <DetailChart pairs={pairs} />
            : <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center", color: "#334455", fontSize: 12 }}>No pair data</div>}
        </div>

        {mp && (
          <div style={{ padding: "0 26px 22px", textAlign: "center" }}>
            <a href={mp.url || `https://dexscreener.com/solana/${token.mint}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-flex", gap: 6, background: "rgba(0,255,136,0.07)", border: "1px solid rgba(0,255,136,0.18)", color: "#00ff88", borderRadius: 9, padding: "9px 18px", fontSize: 11, fontWeight: 700, textDecoration: "none", letterSpacing: 0.5, textTransform: "uppercase" }}>
              View on DexScreener →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Comparison Modal ───────────────────────────────
function CompareModal({ aq, gu, guWallet, guCb, aqCb, onClose }) {
  if (!aq || !gu) return null;
  const aqPnl = aqCb ? Object.values(aqCb).reduce((s, c) => s + (c.solReceived - c.solSpent), 0) : null;
  const guPnl = guCb ? Object.values(guCb).reduce((s, c) => s + (c.solReceived - c.solSpent), 0) : null;
  const metrics = [
    { label: "Portfolio Value (USD)", aq: aq.totalValue, gu: gu.totalValue, f: fUsd },
    { label: "SOL Balance", aq: aq.solBal, gu: gu.solBal, f: (v) => fmt(v, 4) + " SOL" },
    { label: "Token Count", aq: aq.tokenCount, gu: gu.tokenCount, f: (v) => String(v) },
    { label: "Token Value (USD)", aq: aq.tokenVal, gu: gu.tokenVal, f: fUsd },
    { label: "Top Holding %", aq: aq.topPct, gu: gu.topPct, f: (v) => fmt(v, 1) + "%" },
    { label: "Avg Token Value", aq: aq.avgVal, gu: gu.avgVal, f: fUsd },
  ];
  if (aqPnl != null && guPnl != null) {
    metrics.push({ label: "Total PnL (SOL)", aq: aqPnl, gu: guPnl, f: (v) => (v >= 0 ? "+" : "") + fmt(v, 4) + " SOL", isPnl: true });
    metrics.push({ label: "Tokens Traded", aq: Object.keys(aqCb).length, gu: Object.keys(guCb).length, f: (v) => String(v) });
  }
  const aqW = metrics.filter((m) => !m.isPnl ? (m.aq || 0) > (m.gu || 0) : Math.abs(m.aq || 0) > Math.abs(m.gu || 0)).length;
  const guW = metrics.length - aqW;
  const w = aqW > guW ? "aq" : aqW < guW ? "gu" : "tie";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(24px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "linear-gradient(170deg, #0c1525, #0a1220 50%, #080e1a)", border: "1px solid rgba(153,69,255,0.12)", borderRadius: 22, width: "100%", maxWidth: 620, maxHeight: "90vh", overflow: "auto", boxShadow: "0 40px 100px rgba(0,0,0,0.7), 0 0 60px rgba(153,69,255,0.06)", animation: "fadeIn 0.2s ease" }}>
        <div style={{ padding: "24px 28px 0", display: "flex", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 9, color: "#9977cc", textTransform: "uppercase", letterSpacing: 2, fontWeight: 700, marginBottom: 4 }}>Portfolio Showdown{guCb ? " + PnL" : ""}</div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#e8edf5" }}>Aquatic <span style={{ color: "#445566", fontWeight: 400 }}>vs</span> You</h2>
            <div style={{ fontSize: 10, color: "#445566", fontFamily: "monospace", marginTop: 3 }}>{sAddr(guWallet)}</div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "#667788", width: 32, height: 32, borderRadius: 8, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
        <div style={{ margin: "16px 28px", padding: "12px 18px", borderRadius: 12, textAlign: "center",
          background: w === "aq" ? "linear-gradient(135deg, rgba(153,69,255,0.1), rgba(20,241,149,0.05))" : w === "gu" ? "linear-gradient(135deg, rgba(255,170,0,0.1), rgba(255,100,68,0.05))" : "linear-gradient(135deg, rgba(100,150,255,0.06), rgba(100,150,255,0.03))",
          border: `1px solid ${w === "aq" ? "rgba(153,69,255,0.18)" : w === "gu" ? "rgba(255,170,0,0.18)" : "rgba(100,150,255,0.12)"}`,
        }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: w === "aq" ? "#9945ff" : w === "gu" ? "#ffaa00" : "#7799ee" }}>
            {w === "aq" ? "🏆 Aquatic Leads" : w === "gu" ? "🏆 You're Winning!" : "🤝 Dead Even"}
          </div>
          <div style={{ fontSize: 11, color: "#556677", marginTop: 3 }}>{aqW} to {guW} across {metrics.length} metrics</div>
        </div>
        <div style={{ padding: "0 28px 24px" }}>
          {metrics.map((m, i) => {
            const mx = Math.max(Math.abs(m.aq || 0.01), Math.abs(m.gu || 0.01));
            return (
              <div key={i} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#667788", fontWeight: 700, marginBottom: 5 }}>{m.label}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontSize: 9, color: "#9945ff", fontWeight: 700 }}>AQUATIC</span>
                      <span style={{ fontSize: 11, color: "#c8d0e0", fontWeight: 800 }}>{m.f(m.aq)}</span>
                    </div>
                    <div style={{ height: 7, background: "rgba(255,255,255,0.03)", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: (Math.abs(m.aq || 0) / mx) * 100 + "%", background: "linear-gradient(90deg, #9945ff, #14f195)", borderRadius: 4, transition: "width 0.5s" }} />
                    </div>
                  </div>
                  <div style={{ width: 16, textAlign: "center", color: "#334455", fontSize: 9, fontWeight: 800 }}>v</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontSize: 9, color: "#ffaa00", fontWeight: 700 }}>YOU</span>
                      <span style={{ fontSize: 11, color: "#c8d0e0", fontWeight: 800 }}>{m.f(m.gu)}</span>
                    </div>
                    <div style={{ height: 7, background: "rgba(255,255,255,0.03)", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: (Math.abs(m.gu || 0) / mx) * 100 + "%", background: "linear-gradient(90deg, #ffaa00, #ff6644)", borderRadius: 4, transition: "width 0.5s" }} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Token Row ──────────────────────────────────────
function Row({ token, idx, cb, sp, onClick }) {
  const val = token.balance * (token.priceUsd || 0);
  const pct = token.priceChange24h || 0;
  const c = cb?.[token.mint];
  const pnlSol = c ? (c.solReceived - c.solSpent) + ((token.priceNative || 0) * token.balance - (token.balance / (c.bought || 1)) * c.solSpent) : null;
  const pnlUsd = pnlSol != null && sp ? pnlSol * sp : null;
  const spark = useRef(Array.from({ length: 18 }, (_, i) => {
    const b = token.priceUsd || 1, t = b * (1 - (pct / 100) * (1 - i / 17));
    return t + t * (Math.random() - 0.5) * 0.03;
  }));

  return (
    <div onClick={onClick} style={{
      display: "grid", gridTemplateColumns: "28px 1.5fr 0.8fr 0.65fr 0.55fr 0.75fr 100px 0.7fr",
      alignItems: "center", padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,0.025)",
      cursor: "pointer", transition: "background 0.12s",
      background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.006)",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,255,136,0.025)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.006)"; }}
    >
      <div style={{ fontSize: 10, color: "#334455", fontWeight: 800 }}>{idx + 1}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        {token.imageUrl ? (
          <img src={token.imageUrl} alt="" style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, border: "1px solid rgba(255,255,255,0.05)" }} onError={(e) => { e.target.style.display = "none"; }} />
        ) : (
          <div style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, background: `hsl(${(token.mint.charCodeAt(0) * 37) % 360}, 45%, 22%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff" }}>{(token.symbol || "?")[0]}</div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#d0d8e8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{token.symbol || sAddr(token.mint)}</div>
          <div style={{ fontSize: 8, color: "#3a4a5a", fontFamily: "monospace" }}>{sAddr(token.mint)}</div>
        </div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#a0aab8" }}>
        {token.priceUsd ? (token.priceUsd < 0.001 ? "$" + token.priceUsd.toExponential(2) : fUsd(token.priceUsd)) : "—"}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#7888a0" }}>{fmt(token.balance, token.balance < 1 ? 4 : 2)}</div>
      <div style={{ fontSize: 10, fontWeight: 800, color: pCol(pct) }}>{pct !== 0 ? (pct > 0 ? "+" : "") + fmt(pct, 1) + "%" : "—"}</div>
      <div style={{ fontSize: 10, fontWeight: 800, color: pnlSol != null ? pCol(pnlSol) : "#3a4a5a" }}>
        {pnlSol != null ? (
          <>
            <span>{(pnlSol >= 0 ? "+" : "") + fmt(pnlSol, 3)} SOL</span>
            {pnlUsd != null && <div style={{ fontSize: 8, color: "#556677" }}>{fUsd(pnlUsd)}</div>}
          </>
        ) : "—"}
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}><Spark data={spark.current} color={pCol(pct)} /></div>
      <div style={{ fontSize: 12, fontWeight: 800, color: val > 0 ? "#e0e8f0" : "#3a4a5a", textAlign: "right" }}>{val > 0 ? fUsd(val) : "—"}</div>
    </div>
  );
}

// ═════════════════════════════════════════════════════
// DASHBOARD
// ═════════════════════════════════════════════════════
export default function Dashboard() {
  const [solBal, setSolBal] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [selToken, setSelToken] = useState(null);
  const [sortBy, setSortBy] = useState("value");
  const [sortDir, setSortDir] = useState("desc");
  const [noise, setNoise] = useState("");
  const [solPrice, setSolPrice] = useState(null);
  const [cb, setCb] = useState({});
  const [pnlLoading, setPnlLoading] = useState(false);
  const [wsLive, setWsLive] = useState(false);
  const [lastWsUpdate, setLastWsUpdate] = useState(null);
  const [gInput, setGInput] = useState("");
  const [gWallet, setGWallet] = useState(null);
  const [gData, setGData] = useState(null);
  const [gCb, setGCb] = useState(null);
  const [gLoading, setGLoading] = useState(false);
  const [showComp, setShowComp] = useState(false);
  const [aqSnap, setAqSnap] = useState(null);

  useEffect(() => { setNoise(mkNoise()); }, []);

  // ── Hybrid WebSocket + Poll ───────────────────────
  useEffect(() => {
    let ws, reconTimer, destroyed = false;
    const poll = async () => {
      const p = await getSolPrice();
      if (p && !destroyed) { setSolPrice(p); setLastWsUpdate(Date.now()); }
    };
    const connectWs = () => {
      if (destroyed) return;
      try {
        ws = new WebSocket("wss://api.mainnet-beta.solana.com");
        ws.onopen = () => {
          if (destroyed) return;
          setWsLive(true);
          ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "accountSubscribe", params: [
            "So11111111111111111111111111111111111111112",
            { encoding: "base64", commitment: "confirmed" },
          ]}));
        };
        ws.onmessage = () => { poll(); };
        ws.onclose = () => { if (!destroyed) { setWsLive(false); reconTimer = setTimeout(connectWs, 5000); } };
        ws.onerror = () => { if (ws) ws.close(); };
      } catch (e) { reconTimer = setTimeout(connectWs, 5000); }
    };
    poll();
    connectWs();
    const fallback = setInterval(poll, 20000);
    return () => { destroyed = true; ws?.close(); clearTimeout(reconTimer); clearInterval(fallback); };
  }, []);

  // ── Load Main Wallet ──────────────────────────────
  const loadWallet = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [bal, sp] = await Promise.all([getSolBalance(AQUATIC_WALLET), getSolPrice()]);
      setSolBal(bal); if (sp) setSolPrice(sp);
      const accs = await getTokenAccounts(AQUATIC_WALLET);
      const dx = await dexTokens(accs.map((a) => a.mint));
      const enriched = enrichTokens(accs, dx);
      setTokens(enriched);
      setAqSnap(buildSnapshot(enriched, bal, sp));
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { loadWallet(); }, [loadWallet]);

  // ── Load PnL ──────────────────────────────────────
  const loadPnl = useCallback(async () => {
    if (!HELIUS_KEY) return;
    setPnlLoading(true);
    try {
      const [swaps, transfers] = await Promise.all([fetchSwaps(AQUATIC_WALLET), fetchTransfers(AQUATIC_WALLET)]);
      setCb(buildCostBasis(swaps, transfers, AQUATIC_WALLET));
    } catch (e) { console.warn("PnL err:", e); }
    setPnlLoading(false);
  }, []);

  useEffect(() => { loadPnl(); }, [loadPnl]);

  // ── Guest Wallet ──────────────────────────────────
  const loadGuest = useCallback(async () => {
    if (!gWallet) return;
    setGLoading(true);
    try {
      const [bal, sp] = await Promise.all([getSolBalance(gWallet), getSolPrice()]);
      const accs = await getTokenAccounts(gWallet);
      const dx = await dexTokens(accs.map((a) => a.mint));
      const enriched = enrichTokens(accs, dx);
      setGData(buildSnapshot(enriched, bal, sp));
      if (HELIUS_KEY) {
        const [gSwaps, gTransfers] = await Promise.all([fetchSwaps(gWallet, 4), fetchTransfers(gWallet, 2)]);
        setGCb(buildCostBasis(gSwaps, gTransfers, gWallet));
      }
      setShowComp(true);
    } catch (e) { console.warn("Guest err:", e); }
    setGLoading(false);
  }, [gWallet]);

  useEffect(() => { if (gWallet) loadGuest(); }, [loadGuest, gWallet]);

  // ── Derived ───────────────────────────────────────
  const sorted = useMemo(() => [...tokens].sort((a, b) => {
    let va, vb;
    switch (sortBy) {
      case "value": va = a.balance * (a.priceUsd || 0); vb = b.balance * (b.priceUsd || 0); break;
      case "balance": va = a.balance; vb = b.balance; break;
      case "change": va = a.priceChange24h || 0; vb = b.priceChange24h || 0; break;
      case "price": va = a.priceUsd || 0; vb = b.priceUsd || 0; break;
      case "pnl": va = cb[a.mint] ? cb[a.mint].solReceived - cb[a.mint].solSpent : -Infinity; vb = cb[b.mint] ? cb[b.mint].solReceived - cb[b.mint].solSpent : -Infinity; break;
      default: va = a.balance * (a.priceUsd || 0); vb = b.balance * (b.priceUsd || 0);
    }
    return sortDir === "desc" ? vb - va : va - vb;
  }), [tokens, sortBy, sortDir, cb]);

  const tokVal = tokens.reduce((s, t) => s + t.balance * (t.priceUsd || 0), 0);
  const solUsd = solBal != null && solPrice ? solBal * solPrice : 0;
  const total = tokVal + solUsd;
  const goalPct = solBal != null ? (solBal / 10000) * 100 : 0;
  const totalPnlSol = Object.values(cb).reduce((s, c) => s + (c.solReceived - c.solSpent), 0);

  const pie = useMemo(() => {
    const items = [{ label: "SOL", value: solUsd, pct: total > 0 ? (solUsd / total) * 100 : 0 }];
    const s = [...tokens].sort((a, b) => b.balance * (b.priceUsd || 0) - a.balance * (a.priceUsd || 0));
    let other = 0;
    s.forEach((t, i) => {
      const v = t.balance * (t.priceUsd || 0);
      if (v <= 0) return;
      if (i < 7) items.push({ label: t.symbol || sAddr(t.mint), value: v, pct: total > 0 ? (v / total) * 100 : 0 });
      else other += v;
    });
    if (other > 0) items.push({ label: "Other", value: other, pct: total > 0 ? (other / total) * 100 : 0 });
    return items.filter((d) => d.value > 0);
  }, [tokens, solUsd, total]);

  const doSort = (k) => { if (sortBy === k) setSortDir(sortDir === "desc" ? "asc" : "desc"); else { setSortBy(k); setSortDir("desc"); } };
  const SI = ({ c }) => sortBy !== c ? null : <span style={{ marginLeft: 2, fontSize: 7 }}>{sortDir === "desc" ? "▼" : "▲"}</span>;

  return (
    <div style={{ minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "fixed", inset: 0, zIndex: 0, background: "radial-gradient(ellipse at 15% 0%, rgba(153,69,255,0.05) 0%, transparent 50%), radial-gradient(ellipse at 85% 100%, rgba(0,255,136,0.03) 0%, transparent 50%), radial-gradient(ellipse at 50% 50%, rgba(20,60,100,0.06) 0%, transparent 70%)" }} />
      {noise && <div style={{ position: "fixed", inset: 0, zIndex: 1, backgroundImage: `url(${noise})`, backgroundRepeat: "repeat", opacity: 0.5, pointerEvents: "none" }} />}
      <div style={{ position: "relative", zIndex: 2, maxWidth: 1120, margin: "0 auto", padding: "0 18px" }}>

        {/* HEADER */}
        <header style={{ padding: "28px 0 0", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: wsLive ? "#00ff88" : loading ? "#ffaa00" : "#556677", boxShadow: `0 0 10px ${wsLive ? "#00ff88" : loading ? "#ffaa00" : "transparent"}`, animation: wsLive ? "pulse 2.5s infinite" : loading ? "pulse 1.5s infinite" : "none" }} />
            <span style={{ fontSize: 9, color: "#556677", textTransform: "uppercase", letterSpacing: 2, fontWeight: 700 }}>
              {wsLive ? "Live" : loading ? "Syncing" : "Connected"} · Solana Mainnet
              {wsLive && <span style={{ color: "#00ff88", marginLeft: 6 }}>◉ WS + Poll Hybrid</span>}
            </span>
          </div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, background: "linear-gradient(135deg, #e8edf5 0%, #9945ff 30%, #14f195 60%, #00ff88 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: -0.8, lineHeight: 1.2 }}>
            Aquatic&apos;s Retarded Attempt<br />at 10,000 SOL 2026
          </h1>
          <div style={{ fontFamily: "monospace", fontSize: 11, color: "#445566", marginTop: 6, padding: "5px 10px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 7, display: "inline-block", userSelect: "all" }}>
            {AQUATIC_WALLET}
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 9, color: "#556677", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>Goal: 10,000 SOL</span>
              <span style={{ fontSize: 10, color: goalPct >= 100 ? "#00ff88" : "#9945ff", fontWeight: 800 }}>{solBal != null ? fmt(solBal, 2) : "…"} / 10K ({fmt(goalPct, 2)}%)</span>
            </div>
            <div style={{ height: 5, background: "rgba(255,255,255,0.03)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: Math.min(goalPct, 100) + "%", background: "linear-gradient(90deg, #9945ff, #14f195, #00ff88)", borderRadius: 3, transition: "width 0.8s" }} />
            </div>
          </div>
        </header>

        {/* WALLET INPUT */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input value={gInput} onChange={(e) => setGInput(e.target.value)} placeholder="Enter any Solana wallet to compare PnL vs Aquatic…"
            style={{ flex: 1, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "9px 12px", color: "#c8d0e0", fontSize: 11, fontFamily: "monospace", outline: "none" }}
            onKeyDown={(e) => { if (e.key === "Enter" && gInput.length >= 32) setGWallet(gInput.trim()); }} />
          <button onClick={() => { if (gInput.length >= 32) setGWallet(gInput.trim()); }} disabled={gLoading || gInput.length < 32}
            style={{ background: gInput.length >= 32 ? "rgba(255,170,0,0.1)" : "rgba(255,255,255,0.02)", border: `1px solid ${gInput.length >= 32 ? "rgba(255,170,0,0.2)" : "rgba(255,255,255,0.06)"}`, color: gInput.length >= 32 ? "#ffaa00" : "#3a4a5a", borderRadius: 8, padding: "9px 14px", fontSize: 10, fontWeight: 700, cursor: gInput.length >= 32 ? "pointer" : "not-allowed", textTransform: "uppercase", letterSpacing: 1, whiteSpace: "nowrap" }}>
            {gLoading ? "⟳ Loading…" : "⚔ Compare PnL"}
          </button>
        </div>

        {/* CARDS + PIE */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 480px", display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
            {[
              { l: "Total Portfolio", v: loading ? "…" : fUsd(total), c: "#e8edf5", g: "rgba(153,69,255,0.12)", a: "#7766aa" },
              { l: "SOL Balance", v: solBal != null ? fmt(solBal, 4) : "…", s: solUsd > 0 ? "≈ " + fUsd(solUsd) : "", c: "#00ff88", g: "rgba(0,255,136,0.08)", a: "#448866" },
              { l: "Token Value", v: loading ? "…" : fUsd(tokVal), s: tokens.length + " tokens", c: "#ffaa44", g: "rgba(255,170,0,0.08)", a: "#887744" },
              { l: "SOL Price", v: solPrice ? fUsd(solPrice) : "…", s: wsLive ? "Live ◉" : lastWsUpdate ? "Poll ○" : "", c: "#7799ee", g: "rgba(100,150,255,0.08)", a: "#667799" },
            ].map((c, i) => (
              <div key={i} style={{ background: `linear-gradient(145deg, ${c.g} 0%, rgba(10,18,32,0.95) 100%)`, border: `1px solid ${c.g}`, borderRadius: 12, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: -20, right: -20, width: 70, height: 70, background: `radial-gradient(circle, ${c.g} 0%, transparent 70%)`, borderRadius: "50%" }} />
                <div style={{ fontSize: 8, color: c.a, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700, marginBottom: 5 }}>{c.l}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: c.c, fontFeatureSettings: "'tnum'" }}>{c.v}</div>
                {c.s && <div style={{ fontSize: 10, color: "#556677", marginTop: 1 }}>{c.s}</div>}
              </div>
            ))}
          </div>
          <div style={{ flex: "0 0 260px", background: "rgba(8,14,25,0.5)", border: "1px solid rgba(255,255,255,0.03)", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
            {pie.length > 0 ? <Pie data={pie} /> : <div style={{ color: "#334455", fontSize: 11 }}>Loading…</div>}
          </div>
        </div>

        {/* PNL SUMMARY */}
        {Object.keys(cb).length > 0 && (
          <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 12, background: "linear-gradient(135deg, rgba(153,69,255,0.05), rgba(0,255,136,0.03))", border: "1px solid rgba(153,69,255,0.08)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 9, color: "#9977cc", textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700 }}>Helius PnL</span>
            <span style={{ fontSize: 11, color: "#556677" }}>·</span>
            <span style={{ fontSize: 11, color: "#c8d0e0" }}>{Object.keys(cb).length} tokens</span>
            <span style={{ fontSize: 11, color: "#556677" }}>·</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: pCol(totalPnlSol) }}>
              Net: {totalPnlSol >= 0 ? "+" : ""}{fmt(totalPnlSol, 4)} SOL
              <span style={{ color: "#667788", fontWeight: 400, marginLeft: 4 }}>({fUsd(totalPnlSol * (solPrice || 0))})</span>
            </span>
            <span style={{ fontSize: 11, color: "#556677" }}>·</span>
            <span style={{ fontSize: 11, color: "#ff4466" }}>Spent: {fmt(Object.values(cb).reduce((s, c) => s + c.solSpent, 0), 2)} SOL</span>
            <span style={{ fontSize: 11, color: "#556677" }}>·</span>
            <span style={{ fontSize: 11, color: "#00ff88" }}>Received: {fmt(Object.values(cb).reduce((s, c) => s + c.solReceived, 0), 2)} SOL</span>
          </div>
        )}

        {/* CONTROLS */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8, gap: 6 }}>
          {gWallet && gData && aqSnap && (
            <button onClick={() => setShowComp(true)} style={{ background: "rgba(255,170,0,0.07)", border: "1px solid rgba(255,170,0,0.15)", color: "#ffaa00", padding: "7px 14px", borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}>⚔ Comparison</button>
          )}
          <button onClick={loadWallet} disabled={loading} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", color: loading ? "#334455" : "#778899", padding: "7px 14px", borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", textTransform: "uppercase", letterSpacing: 1 }}>
            {loading ? "⟳ Loading…" : "⟳ Refresh"}
          </button>
        </div>

        {err && <div style={{ background: "rgba(255,68,102,0.06)", border: "1px solid rgba(255,68,102,0.15)", borderRadius: 12, padding: "12px 16px", marginBottom: 14, color: "#ff6688", fontSize: 12 }}><strong>Error:</strong> {err}</div>}

        {/* TABLE */}
        <div style={{ background: "rgba(8,14,25,0.7)", border: "1px solid rgba(255,255,255,0.03)", borderRadius: 14, overflow: "hidden", boxShadow: "0 16px 48px rgba(0,0,0,0.25)", marginBottom: 32 }}>
          <div style={{ display: "grid", gridTemplateColumns: "28px 1.5fr 0.8fr 0.65fr 0.55fr 0.75fr 100px 0.7fr", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.012)" }}>
            {[
              { k: null, l: "#" }, { k: null, l: "Token" }, { k: "price", l: "Price" },
              { k: "balance", l: "Balance" }, { k: "change", l: "24h" }, { k: "pnl", l: "PnL" },
              { k: null, l: "Chart", s: { textAlign: "center" } }, { k: "value", l: "Value", s: { textAlign: "right" } },
            ].map((c, i) => (
              <div key={i} onClick={c.k ? () => doSort(c.k) : undefined}
                style={{ fontSize: 8, color: "#3a4a5a", textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 800, cursor: c.k ? "pointer" : "default", userSelect: "none", ...c.s }}>
                {c.l}{c.k && <SI c={c.k} />}
              </div>
            ))}
          </div>
          {loading && !tokens.length && (
            <div style={{ padding: "44px 16px", textAlign: "center" }}>
              <div style={{ width: 32, height: 32, border: "2px solid rgba(153,69,255,0.15)", borderTopColor: "#9945ff", borderRadius: "50%", margin: "0 auto 12px", animation: "spin 1s linear infinite" }} />
              <div style={{ fontSize: 11, color: "#445566" }}>Fetching from Solana + DexScreener + Helius…</div>
            </div>
          )}
          {!loading && !sorted.length && <div style={{ padding: "44px 16px", textAlign: "center", color: "#3a4a5a", fontSize: 12 }}>No tokens found</div>}
          {sorted.map((t, i) => <Row key={t.mint} token={t} idx={i} cb={cb} sp={solPrice} onClick={() => setSelToken(t)} />)}
        </div>

        <footer style={{ padding: "12px 0 32px", textAlign: "center", fontSize: 9, color: "#2a3a4a" }}>
          <div>Helius Enhanced Transactions · DexScreener · Solana RPC · Hybrid WS+Poll</div>
          <div style={{ fontFamily: "monospace", marginTop: 3 }}>Tactile Maximalism · {new Date().toLocaleDateString()}</div>
        </footer>
      </div>

      {selToken && <TokenModal token={selToken} cb={cb} solPrice={solPrice} onClose={() => setSelToken(null)} />}
      {showComp && aqSnap && gData && <CompareModal aq={aqSnap} gu={gData} guWallet={gWallet} guCb={gCb} aqCb={cb} onClose={() => setShowComp(false)} />}
    </div>
  );
}
