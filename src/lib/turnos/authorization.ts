import { getTurnosSupabaseClient } from "@/lib/turnos/supabase";

export type ComercioAccess = {
  comercioId: string;
  comercioNombre: string;
};

// Authorization layer, deliberately separate from authentication
// (requireTurnosUser in ./auth.ts only answers "who is this user"; this
// answers "which comercio(s) can they administer"). Backed by a new table,
// `usuario_comercios` (user_id -> comercio_id), documented with its SQL in
// docs/turnos/base-de-datos.md — not part of the WhatsApp bot's schema.
//
// Reads via the privileged service-role client (not the session-bound auth
// client): usuario_comercios is authorization metadata the app itself
// manages, not user-owned business data behind RLS, so there is no need to
// route it through the user's own session/RLS. Today there is a single demo
// comercio, but a user could already have rows for more than one — the
// caller decides how many to use (see src/app/turnos/dashboard/page.tsx).
export async function getComerciosForUser(userId: string): Promise<ComercioAccess[]> {
  const supabase = getTurnosSupabaseClient();

  const { data: links, error: linksError } = await supabase
    .from("usuario_comercios")
    .select("comercio_id")
    .eq("user_id", userId);

  if (linksError) {
    console.error("turnos/authorization: error consultando usuario_comercios:", linksError.message);
    return [];
  }

  const comercioIds = (links ?? []).map((link) => link.comercio_id as string);
  if (comercioIds.length === 0) return [];

  const { data: comercios, error: comerciosError } = await supabase
    .from("comercios")
    .select("id, nombre")
    .in("id", comercioIds)
    .eq("activo", true);

  if (comerciosError) {
    console.error("turnos/authorization: error consultando comercios:", comerciosError.message);
    return [];
  }

  return (comercios ?? []).map((comercio) => ({
    comercioId: comercio.id as string,
    comercioNombre: comercio.nombre as string,
  }));
}
