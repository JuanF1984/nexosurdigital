const FECHA_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const ESTADO_LABEL: Record<string, string> = {
  confirmado: "Confirmado",
  cancelado: "Cancelado",
};

const CANAL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  web: "Web",
};

// `fecha` llega como "YYYY-MM-DD" (columna `date`). Construir la fecha con
// año/mes/día explícitos evita que `new Date("YYYY-MM-DD")` la interprete en
// UTC y el día se corra hacia atrás en timezones negativos (ej. Argentina).
export function formatFecha(fechaISO: string): string {
  const [year, month, day] = fechaISO.split("-").map(Number);
  return FECHA_FORMATTER.format(new Date(year, month - 1, day));
}

// `hora_inicio`/`hora_fin` llegan como "HH:MM:SS" (columna `time`).
export function formatHora(horaISO: string): string {
  return horaISO.slice(0, 5);
}

export function formatEstado(estado: string): string {
  return ESTADO_LABEL[estado] ?? estado;
}

export function formatCanal(canal: string): string {
  return CANAL_LABEL[canal] ?? canal;
}
