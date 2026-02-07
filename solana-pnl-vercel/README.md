# Aquatic's Retarded Attempt at 10,000 SOL 2026

Real-time Solana wallet PnL dashboard with cost-basis tracking, live price streaming, and wallet-vs-wallet comparison.

![Solana](https://img.shields.io/badge/Solana-Mainnet-9945ff?style=flat-square)
![Next.js](https://img.shields.io/badge/Next.js-14-000?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-00ff88?style=flat-square)

## Features

- **Real-time Portfolio Tracking** — SOL balance + all SPL token holdings with USD values
- **Helius Cost-Basis PnL** — Parses swap & transfer history via Enhanced Transactions API to compute realized/unrealized profit per token
- **Hybrid WebSocket + Poll** — Live SOL price via Solana WS trigger + DexScreener polling with auto-reconnect
- **D3.js Visualizations** — Portfolio allocation pie chart, per-token sparkline charts, interactive detail charts
- **Wallet Comparison** — Enter any Solana wallet to compare portfolio metrics and PnL against the tracked wallet
- **Tactile Maximalism UI** — Noise textures, layered gradients, glass morphism, procedural backgrounds

## Architecture

```
src/
├── app/
│   ├── layout.js          # Root layout, metadata, fonts
│   ├── page.js            # Page wrapper
│   └── globals.css        # Global styles + animations
├── components/
│   └── Dashboard.js       # Main client component (all UI)
└── lib/
    ├── config.js          # Constants, env vars, formatters
    └── api.js             # All API functions + PnL engine
```

### Data Flow

```
Solana RPC (via Helius) → Token Accounts → DexScreener Enrichment → Dashboard
                                                    ↓
Helius Enhanced Txns → Swap/Transfer History → Cost-Basis Engine → PnL Display
                                                    ↓
WebSocket (Solana) → Trigger → DexScreener Poll → Live SOL Price
                                                    ↓
Guest Wallet Input → Same Pipeline → Comparison Modal
```

### APIs Used (All Free Tier)

| API | Purpose | Rate Limit |
|-----|---------|------------|
| [Helius RPC](https://helius.dev) | Solana RPC + Enhanced Transactions | 500K credits/mo free |
| [DexScreener](https://dexscreener.com) | Token prices, volume, liquidity | 300 req/min, no key |
| Solana WebSocket | Live account change triggers | Public endpoint |

## Quick Start

### Prerequisites

- Node.js >= 18.17
- A [Helius API key](https://dashboard.helius.dev) (free, no credit card)

### Local Development

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/solana-pnl.git
cd solana-pnl

# Install
npm install

# Configure
cp .env.example .env.local
# Edit .env.local with your Helius API key

# Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_HELIUS_KEY` | Yes | Helius API key for RPC + Enhanced Transactions |
| `NEXT_PUBLIC_DEFAULT_WALLET` | No | Default Solana wallet to track (defaults to Aquatic's) |

## Deploy to Vercel

### One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/solana-pnl&env=NEXT_PUBLIC_HELIUS_KEY&envDescription=Get%20a%20free%20Helius%20API%20key%20at%20dashboard.helius.dev)

### Manual Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set env vars in Vercel dashboard:
# NEXT_PUBLIC_HELIUS_KEY = your-helius-key
```

### GitHub → Vercel Auto-Deploy

1. Push this repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import the repository
4. Add `NEXT_PUBLIC_HELIUS_KEY` in Environment Variables
5. Deploy — Vercel auto-detects Next.js

## GitHub Setup

```bash
# Initialize
cd solana-pnl
git init
git add .
git commit -m "feat: solana pnl dashboard v3 — helius + dexscreener + ws hybrid"

# Create repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/solana-pnl.git
git branch -M main
git push -u origin main
```

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Charting:** D3.js v7
- **Styling:** Inline styles (zero CSS framework dependencies)
- **Fonts:** DM Sans (Google Fonts)
- **Deployment:** Vercel (zero config)

## License

MIT
