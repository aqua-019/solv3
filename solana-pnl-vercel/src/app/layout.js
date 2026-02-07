import "./globals.css";

export const metadata = {
  title: "Aquatic's Retarded Attempt at 10,000 SOL 2026",
  description:
    "Real-time Solana wallet PnL dashboard with Helius cost-basis tracking, DexScreener market data, and wallet comparison.",
  openGraph: {
    title: "Aquatic's Retarded Attempt at 10,000 SOL 2026",
    description: "Solana PnL Dashboard — Live portfolio tracking with cost-basis analysis",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Aquatic's Retarded Attempt at 10,000 SOL 2026",
    description: "Solana PnL Dashboard — Live portfolio tracking with cost-basis analysis",
  },
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
