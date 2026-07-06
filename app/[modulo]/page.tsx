import { notFound } from "next/navigation";
import { getModulo } from "@/lib/config";
import ChatModulo from "../ChatModulo";

export default async function ModuloPage({
  params,
}: {
  params: Promise<{ modulo: string }>;
}) {
  const { modulo } = await params;
  const m = getModulo(modulo);
  if (!m) notFound();

  return (
    <ChatModulo
      modulo={m.key}
      nome={m.nome}
      integracao={m.fonte}
      ativo={m.disponivel}
      sugestoes={m.sugestoes}
    />
  );
}
