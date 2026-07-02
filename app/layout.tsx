import type { Metadata } from "next";
import "./globals.css";
import { getBrand } from "@/lib/config";

export function generateMetadata(): Metadata {
  const b = getBrand();
  return { title: b.nome, description: b.subtitulo };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const b = getBrand();
  const overrides = Object.entries(b.temaVars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  const css = overrides ? `:root{${overrides}}` : "";
  const brandJson = JSON.stringify({ nome: b.nome, subtitulo: b.subtitulo, logo: b.logo });

  return (
    <html lang="pt">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content={b.themeColor} />
        {css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
        <script dangerouslySetInnerHTML={{ __html: `window.__BRAND__=${brandJson}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
