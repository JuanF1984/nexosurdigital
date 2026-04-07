import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexosur Digital — Hacemos simple lo digital",
  description:
    "Soluciones digitales simples para comercios y profesionales. Turnos online, páginas web, herramientas a medida. San Andrés de Giles y zona.",
  openGraph: {
    title: "Nexosur Digital — Hacemos simple lo digital",
    description:
      "Soluciones digitales simples para comercios y profesionales.",
    url: "https://nexosur.com",
    siteName: "Nexosur Digital",
    locale: "es_AR",
    type: "website",
    images: [
      {
        url: "https://nexosurdigital.com/og-image.png",
        width: 1200,
        height: 630,
        alt: "Nexosur Digital — Hacemos simple lo digital",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="scroll-smooth">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Sora:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
