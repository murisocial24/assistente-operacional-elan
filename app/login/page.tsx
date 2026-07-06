"use client";

import { useEffect, useState } from "react";

type Brand = { nome: string; subtitulo: string; logo: string | null };

export default function LoginPage() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const b = (window as unknown as { __BRAND__?: Brand }).__BRAND__;
    if (b) setBrand(b);
  }, []);

  async function submit() {
    if (!password || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        window.location.href = "/";
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.erro ?? "Não foi possível entrar.");
      }
    } catch {
      setError("Erro de ligação.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        {brand?.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="brand-logo" src={brand.logo} alt={brand.nome} />
        ) : (
          <div className="brand-mark" />
        )}
        <h1>{brand?.nome ?? "Assistente Operacional"}</h1>
        <p>Introduza os seus dados para entrar.</p>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Utilizador"
          autoComplete="username"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Palavra-passe"
          autoComplete="current-password"
        />
        <button onClick={submit} disabled={loading}>
          Entrar
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
