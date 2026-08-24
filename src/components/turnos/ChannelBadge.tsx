import { formatCanal } from "@/lib/turnos/format";

export function ChannelBadge({ canal }: { canal: string }) {
  const isWhatsapp = canal === "whatsapp";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wide ${
        isWhatsapp
          ? "border-whatsapp/30 bg-whatsapp/10 text-whatsapp"
          : "border-accent-blue/25 bg-accent-blue/10 text-accent-blue"
      }`}
    >
      {formatCanal(canal)}
    </span>
  );
}
