// ═══════════════════════════════════════════════════════
// Config & Constants
// ═══════════════════════════════════════════════════════

export const AQUATIC_WALLET =
  process.env.NEXT_PUBLIC_DEFAULT_WALLET ||
  "H1qpELxeLZoAuMKDQ88ApyUbyxvDKnh9YGpaA715NjaF";

export const HELIUS_KEY =
  process.env.NEXT_PUBLIC_HELIUS_KEY || "";

export const HELIUS_RPC = HELIUS_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
  : "https://api.mainnet-beta.solana.com";

export const HELIUS_API = "https://api-mainnet.helius-rpc.com/v0";
export const LAMPORTS = 1e9;
export const SOL_MINT = "So11111111111111111111111111111111111111112";

// ═══════════════════════════════════════════════════════
// Formatters
// ═══════════════════════════════════════════════════════

export function fmt(n, d = 2) {
  if (n == null || isNaN(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(d) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(d) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(d) + "K";
  if (a < 0.0001 && a !== 0) return n.toExponential(2);
  return n.toFixed(d);
}

export function fUsd(n) {
  return n == null || isNaN(n) ? "$—" : "$" + fmt(n);
}

export function sAddr(a) {
  return a ? a.slice(0, 4) + "…" + a.slice(-4) : "";
}

export function pCol(p) {
  return p > 0 ? "#00ff88" : p < 0 ? "#ff4466" : "#556677";
}
