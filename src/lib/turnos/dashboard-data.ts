import { getTurnosSupabaseClient } from "@/lib/turnos/supabase";

// Server-only read access for the Turnos dashboard. Reads `turnos` joined
// with `servicios`/`recursos` (both read-only lookups, same schema the
// WhatsApp bot in Proyectos/whatsapp-demo already uses — see
// docs/turnos/base-de-datos.md). Uses the privileged service-role client,
// never the session-bound auth client: which rows a user gets to see is
// decided in application code (the caller already resolved and passed in an
// authorized comercioId via getComerciosForUser), not by Postgres RLS.

export type SectionResult<T> = { ok: true; data: T } | { ok: false };

export type TurnoRecord = {
  id: string;
  clienteNombre: string;
  telefono: string;
  servicioNombre: string | null;
  recursoNombre: string | null;
  cantidadPersonas: number | null;
  fecha: string; // "YYYY-MM-DD"
  horaInicio: string; // "HH:MM:SS"
  horaFin: string; // "HH:MM:SS"
  estado: string; // "confirmado" | "cancelado"
  canal: string; // "whatsapp" | "web"
};

export type TurnosResumen = {
  hoyCount: number;
  proximasCount: number;
};

export type TurnosDashboardData = {
  comercio: { id: string; nombre: string; timezone: string } | null;
  today: string | null;
  resumen: TurnosResumen | null;
  turnos: SectionResult<TurnoRecord[]>;
};

const TURNOS_MAX_ROWS = 200;

// "Hoy" siempre se calcula en el timezone del COMERCIO (columna
// comercios.timezone, IANA), nunca en el del servidor — mismo criterio que
// usa el bot de WhatsApp (ver docs/base-de-datos.md del proyecto
// whatsapp-demo). El formato en-CA de Intl da directamente "YYYY-MM-DD",
// comparable con la columna `fecha` (date) sin parsear.
function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// El embed de una relación N:1 (turnos.servicio_id -> servicios.id) vuelve
// como objeto en supabase-js, pero se maneja también el caso array de forma
// defensiva porque no hay tipos generados (Database) para este proyecto.
function firstOrNull<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function getTurnosDashboardData(comercioId: string): Promise<TurnosDashboardData> {
  const supabase = getTurnosSupabaseClient();

  const { data: comercioRow, error: comercioError } = await supabase
    .from("comercios")
    .select("id, nombre, timezone")
    .eq("id", comercioId)
    .maybeSingle();

  if (comercioError) {
    console.error("turnos/dashboard: error consultando comercio:", comercioError.message);
  }

  if (!comercioRow) {
    return { comercio: null, today: null, resumen: null, turnos: { ok: false } };
  }

  const comercio = {
    id: comercioRow.id as string,
    nombre: comercioRow.nombre as string,
    timezone: comercioRow.timezone as string,
  };
  const today = todayInTimezone(comercio.timezone);

  const { data, error } = await supabase
    .from("turnos")
    .select(
      "id, telefono, nombre_cliente, cantidad_personas, fecha, hora_inicio, hora_fin, estado, canal, servicios(nombre), recursos(nombre)"
    )
    .eq("comercio_id", comercioId)
    .gte("fecha", today)
    .order("fecha", { ascending: true })
    .order("hora_inicio", { ascending: true })
    .limit(TURNOS_MAX_ROWS);

  if (error) {
    // Esperable hasta que se apliquen los permisos de lectura documentados
    // en docs/turnos/base-de-datos.md. Nunca se muestra crudo al usuario.
    console.error("turnos/dashboard: error consultando turnos:", error.message);
    return { comercio, today, resumen: null, turnos: { ok: false } };
  }

  type ServicioEmbed = { nombre: string };
  type RecursoEmbed = { nombre: string };
  type TurnoRow = {
    id: string;
    telefono: string;
    nombre_cliente: string;
    cantidad_personas: number | null;
    fecha: string;
    hora_inicio: string;
    hora_fin: string;
    estado: string;
    canal: string;
    servicios: ServicioEmbed | ServicioEmbed[] | null;
    recursos: RecursoEmbed | RecursoEmbed[] | null;
  };

  const turnos: TurnoRecord[] = ((data ?? []) as unknown as TurnoRow[]).map((row) => {
    const servicio = firstOrNull(row.servicios);
    const recurso = firstOrNull(row.recursos);

    return {
      id: row.id,
      clienteNombre: row.nombre_cliente,
      telefono: row.telefono,
      servicioNombre: servicio?.nombre ?? null,
      recursoNombre: recurso?.nombre ?? null,
      cantidadPersonas: row.cantidad_personas,
      fecha: row.fecha,
      horaInicio: row.hora_inicio,
      horaFin: row.hora_fin,
      estado: row.estado,
      canal: row.canal,
    };
  });

  // El resumen solo cuenta reservas confirmadas: una fila cancelada sigue
  // apareciendo en el listado (para que el equipo la vea), pero no debe
  // inflar los contadores operativos de "hoy" / "próximas".
  const resumen: TurnosResumen = {
    hoyCount: turnos.filter((turno) => turno.fecha === today && turno.estado === "confirmado").length,
    proximasCount: turnos.filter((turno) => turno.fecha > today && turno.estado === "confirmado").length,
  };

  return { comercio, today, resumen, turnos: { ok: true, data: turnos } };
}
