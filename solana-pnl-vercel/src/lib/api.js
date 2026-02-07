import {
  HELIUS_RPC,
  HELIUS_API,
  HELIUS_KEY,
  LAMPORTS,
  SOL_MINT,
} from "./config";

// ═══════════════════════════════════════════════════════
// Solana JSON-RPC (via Helius if key present)
// ═══════════════════════════════════════════════════════

export async function rpc(method, params, endpoint = HELIUS_RPC) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()).result;
}

export async function getSolBalance(wallet) {
  const r = await rpc("getBalance", [wallet]);
  return (r?.value || 0) / LAMPORTS;
}

export async function getTokenAccounts(wallet) {
  const r = await rpc("getTokenAccountsByOwner", [
    wallet,
    { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { encoding: "jsonParsed" },
  ]);
  return (r?.value || [])
    .map((a) => {
      const i = a.account.data.parsed.info;
      return {
        mint: i.mint,
        balance: parseFloat(i.tokenAmount.uiAmountString || "0"),
        decimals: i.tokenAmount.decimals,
      };
    })
    .filter((t) => t.balance > 0);
}

// ═══════════════════════════════════════════════════════
// DexScreener (free, no key)
// ═══════════════════════════════════════════════════════

export async function dexTokens(mints) {
  if (!mints.length) return [];
  const out = [];
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    try {
      const r = await fetch(
        `https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`
      );
      if (r.ok) {
        const d = await r.json();
        out.push(...(Array.isArray(d) ? d : d.pairs || []));
      }
    } catch (e) {
      console.warn("DexScreener batch error:", e);
    }
    if (i + 30 < mints.length)
      await new Promise((r) => setTimeout(r, 350));
  }
  return out;
}

export async function dexPairs(mint) {
  try {
    const r = await fetch(
      `https://api.dexscreener.com/token-pairs/v1/solana/${mint}`
    );
    if (r.ok) {
      const d = await r.json();
      return Array.isArray(d) ? d : d.pairs || [];
    }
  } catch (e) {
    console.warn("DexScreener pairs error:", e);
  }
  return [];
}

export async function getSolPrice() {
  try {
    const r = await fetch(
      `https://api.dexscreener.com/tokens/v1/solana/${SOL_MINT}`
    );
    if (r.ok) {
      const d = await r.json();
      const p = (Array.isArray(d) ? d : d.pairs || [])[0];
      if (p) return parseFloat(p.priceUsd || 0);
    }
  } catch (e) {
    console.warn("SOL price error:", e);
  }
  return 0;
}

// ═══════════════════════════════════════════════════════
// Helius Enhanced Transactions
// ═══════════════════════════════════════════════════════

export async function fetchSwaps(wallet, maxPages = 8) {
  if (!HELIUS_KEY) return [];
  const all = [];
  let lastSig = null;
  for (let p = 0; p < maxPages; p++) {
    let url = `${HELIUS_API}/addresses/${wallet}/transactions?api-key=${HELIUS_KEY}&type=SWAP`;
    if (lastSig) url += `&before=${lastSig}`;
    try {
      const r = await fetch(url);
      if (!r.ok) break;
      const txns = await r.json();
      if (!txns?.length) break;
      all.push(...txns);
      lastSig = txns[txns.length - 1].signature;
      if (txns.length < 100) break;
    } catch (e) {
      break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return all;
}

export async function fetchTransfers(wallet, maxPages = 4) {
  if (!HELIUS_KEY) return [];
  const all = [];
  let lastSig = null;
  for (let p = 0; p < maxPages; p++) {
    let url = `${HELIUS_API}/addresses/${wallet}/transactions?api-key=${HELIUS_KEY}&type=TRANSFER`;
    if (lastSig) url += `&before=${lastSig}`;
    try {
      const r = await fetch(url);
      if (!r.ok) break;
      const txns = await r.json();
      if (!txns?.length) break;
      all.push(...txns);
      lastSig = txns[txns.length - 1].signature;
      if (txns.length < 100) break;
    } catch (e) {
      break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return all;
}

// ═══════════════════════════════════════════════════════
// Cost-Basis Engine
// ═══════════════════════════════════════════════════════

export function buildCostBasis(swapTxns, transferTxns, wallet) {
  const data = {};
  const ensure = (mint) => {
    if (!data[mint])
      data[mint] = {
        solSpent: 0,
        solReceived: 0,
        bought: 0,
        sold: 0,
        trades: [],
        transfers: [],
      };
  };

  for (const tx of swapTxns) {
    if (!tx.tokenTransfers?.length) continue;
    const ts = tx.timestamp;
    let solOut = 0,
      solIn = 0;

    for (const nt of tx.nativeTransfers || []) {
      if (nt.fromUserAccount === wallet)
        solOut += (nt.amount || 0) / LAMPORTS;
      if (nt.toUserAccount === wallet)
        solIn += (nt.amount || 0) / LAMPORTS;
    }
    for (const tt of tx.tokenTransfers) {
      if (tt.mint === SOL_MINT) {
        if (tt.fromUserAccount === wallet) solOut += tt.tokenAmount || 0;
        if (tt.toUserAccount === wallet) solIn += tt.tokenAmount || 0;
      }
    }

    for (const tt of tx.tokenTransfers) {
      if (!tt.mint || tt.mint === SOL_MINT) continue;
      ensure(tt.mint);
      const amt = tt.tokenAmount || 0;
      if (tt.toUserAccount === wallet && amt > 0) {
        data[tt.mint].bought += amt;
        data[tt.mint].solSpent += solOut;
        data[tt.mint].trades.push({
          type: "BUY",
          amount: amt,
          sol: solOut,
          ts,
          sig: tx.signature,
        });
      } else if (tt.fromUserAccount === wallet && amt > 0) {
        data[tt.mint].sold += amt;
        data[tt.mint].solReceived += solIn;
        data[tt.mint].trades.push({
          type: "SELL",
          amount: amt,
          sol: solIn,
          ts,
          sig: tx.signature,
        });
      }
    }
  }

  for (const tx of transferTxns) {
    for (const tt of tx.tokenTransfers || []) {
      if (!tt.mint || tt.mint === SOL_MINT) continue;
      ensure(tt.mint);
      const amt = tt.tokenAmount || 0;
      if (tt.toUserAccount === wallet && amt > 0) {
        data[tt.mint].transfers.push({
          type: "IN",
          amount: amt,
          ts: tx.timestamp,
          sig: tx.signature,
        });
      } else if (tt.fromUserAccount === wallet && amt > 0) {
        data[tt.mint].transfers.push({
          type: "OUT",
          amount: amt,
          ts: tx.timestamp,
          sig: tx.signature,
        });
      }
    }
  }
  return data;
}

// ═══════════════════════════════════════════════════════
// Enrich tokens with DexScreener data
// ═══════════════════════════════════════════════════════

export function enrichTokens(accounts, dexData) {
  return accounts.map((a) => {
    const matches = dexData.filter(
      (p) => p.baseToken?.address === a.mint
    );
    const best = matches.sort(
      (x, y) => (y.liquidity?.usd || 0) - (x.liquidity?.usd || 0)
    )[0];
    return {
      ...a,
      symbol: best?.baseToken?.symbol,
      name: best?.baseToken?.name,
      priceUsd: best ? parseFloat(best.priceUsd || 0) : 0,
      priceNative: best ? parseFloat(best.priceNative || 0) : 0,
      priceChange24h: best?.priceChange?.h24 || 0,
      volume24h: best?.volume?.h24 || 0,
      liquidity: best?.liquidity?.usd || 0,
      marketCap: best?.marketCap || best?.fdv || 0,
      imageUrl: best?.info?.imageUrl,
      pairUrl: best?.url,
      txns: best?.txns || {},
      dexId: best?.dexId,
    };
  });
}

// ═══════════════════════════════════════════════════════
// Build snapshot for comparison
// ═══════════════════════════════════════════════════════

export function buildSnapshot(enrichedTokens, solBal, solPrice) {
  const tv = enrichedTokens.reduce(
    (s, t) => s + t.balance * (t.priceUsd || 0),
    0
  );
  const sv = solBal * (solPrice || 0);
  const sorted = [...enrichedTokens].sort(
    (a, b) =>
      b.balance * (b.priceUsd || 0) - a.balance * (a.priceUsd || 0)
  );
  const topPct =
    tv > 0 && sorted.length
      ? ((sorted[0].balance * (sorted[0].priceUsd || 0)) / tv) * 100
      : 0;
  return {
    totalValue: tv + sv,
    solBal,
    tokenCount: enrichedTokens.length,
    tokenVal: tv,
    topPct,
    avgVal: enrichedTokens.length ? tv / enrichedTokens.length : 0,
  };
}
