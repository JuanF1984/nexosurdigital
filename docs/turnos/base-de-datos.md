# Base de datos de Turnos

El dashboard de `nexosur-web` **lee** la misma Supabase que ya usa el bot de
WhatsApp (`Proyectos/whatsapp-demo`, proyecto separado, no tocado). Este
documento cubre solo lo relevante para el dashboard: qué tablas existentes se
leen y la única tabla nueva que este trabajo agrega.

El esquema de las tablas existentes se tomó de la documentación real de
`Proyectos/whatsapp-demo` (`docs/base-de-datos.md`, `docs/arquitectura.md`,
`docs/configuracion.md`, `docs/estado-proyecto.md`) y se confirmó contra su
código (`lib/reservas/*.js`, `lib/supabaseClient.js`) — no se adivinó ningún
nombre de columna.

## Tablas existentes que el dashboard lee (sin modificarlas)

Acceso siempre vía `getTurnosSupabaseClient()` (service role, server-only,
ver `docs/turnos/arquitectura.md`), nunca desde el navegador.

### `comercios`

| Columna | Uso en el dashboard |
|---|---|
| `id` | Filtra `turnos` por comercio |
| `nombre` | Título del dashboard |
| `timezone` | IANA — usado para calcular "hoy" (ver más abajo). **Nunca** se usa el timezone del servidor |
| `activo` | `getComerciosForUser` solo considera comercios activos |

### `turnos`

| Columna | Uso en el dashboard |
|---|---|
| `nombre_cliente` | "Nombre del cliente" |
| `telefono` | "Teléfono de contacto" |
| `servicio_id` → `servicios.nombre` (embed) | "Servicio" |
| `recurso_id` → `recursos.nombre` (embed) | "Recurso asignado" |
| `cantidad_personas` | "Cantidad de personas" (puede ser `null`) |
| `fecha`, `hora_inicio` | "Fecha" y "Hora" |
| `estado` (`confirmado` \| `cancelado`) | Badge de estado |
| `canal` (`whatsapp` \| `web`) | Badge de canal |

Consulta real (`src/lib/turnos/dashboard-data.ts`):

```ts
supabase
  .from("turnos")
  .select(
    "id, telefono, nombre_cliente, cantidad_personas, fecha, hora_inicio, hora_fin, estado, canal, servicios(nombre), recursos(nombre)"
  )
  .eq("comercio_id", comercioId)
  .gte("fecha", today)          // today = hoy en el timezone DEL COMERCIO
  .order("fecha", { ascending: true })
  .order("hora_inicio", { ascending: true })
  .limit(200);
```

No se escribe nunca en `turnos` desde este dashboard (sin cancelar, sin
reprogramar, sin editar) — ver `docs/turnos/dashboard.md` para qué haría
falta agregar antes de una primera acción de escritura.

### `servicios` / `recursos`

Solo se leen embebidos (`servicios(nombre)`, `recursos(nombre)`) para
mostrar el nombre — el dashboard no lista ni administra servicios/recursos
en esta versión.

## Tabla nueva: `usuario_comercios`

Exclusiva de este dashboard — el bot de WhatsApp no la usa. Mapea qué
usuario de Supabase Auth (de Turnos) puede administrar qué comercio,
manteniendo autenticación y autorización como conceptos separados (ver
`docs/turnos/arquitectura.md`).

**No se aplicó automáticamente.** Igual que MIDE (`supabase/migrations/*` no
se corrió a ciegas contra la base real) y que `excepciones_disponibilidad` en
`whatsapp-demo`, este SQL debe pegarse a mano en el **SQL Editor del proyecto
de Supabase de Turnos** (no el de MIDE) por quien tenga acceso a ese
proyecto:

```sql
create table if not exists public.usuario_comercios (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    comercio_id uuid not null references public.comercios(id) on delete cascade,
    rol text not null default 'admin',
    created_at timestamptz not null default now(),
    unique (user_id, comercio_id)
);

alter table public.usuario_comercios enable row level security;
-- Sin políticas públicas: el único acceso es service_role desde el
-- servidor (getTurnosSupabaseClient), igual que el resto de las tablas de
-- negocio de Turnos (ver docs/base-de-datos.md de whatsapp-demo).

comment on table public.usuario_comercios is
  'Autorización del dashboard de Turnos: qué usuario (auth.users) puede administrar qué comercio. No participa del bot de WhatsApp.';
comment on column public.usuario_comercios.rol is
  'Reservado para diferenciar permisos dentro de un mismo comercio a futuro (ej. admin vs solo lectura). Hoy no se usa para restringir nada: cualquier fila habilita acceso de lectura completo al comercio.';

grant select on public.usuario_comercios to service_role;
```

Notas:

- `unique (user_id, comercio_id)`: evita filas duplicadas si se asigna el
  mismo comercio dos veces al mismo usuario.
- El `grant select` explícito es defensivo: según
  `docs/estado-proyecto.md` de `whatsapp-demo`, ese proyecto ya corrigió
  `service_role` con `GRANT` + `ALTER DEFAULT PRIVILEGES` sobre `public`
  para que las tablas futuras hereden privilegios automáticamente — es
  posible que esta tabla ya quede cubierta por eso. El `grant` de arriba no
  hace daño si ya estaba cubierto (es idempotente en la práctica) y
  garantiza que funcione si no lo estaba.
- Habilitar RLS sin políticas es el mismo criterio ya usado en el resto de
  las tablas de Turnos (y en MIDE): el acceso real está controlado por quién
  tiene la service role key, no por políticas de Postgres.

## Cómo dar de alta el primer usuario del dashboard

No hay todavía una pantalla de alta de usuarios (fuera de alcance de esta
primera versión). Pasos manuales, en el proyecto de Supabase de **Turnos**:

1. **Authentication → Users → Add user** en el dashboard de Supabase:
   crear el usuario con email + contraseña.
2. Copiar el `id` (UUID) de ese usuario.
3. En el SQL Editor, insertar la fila de autorización para el comercio demo:

   ```sql
   insert into public.usuario_comercios (user_id, comercio_id)
   values (
     '<uuid del usuario creado en el paso 1>',
     (select id from public.comercios where nombre = 'Demo Reservas Nexo Sur')
   );
   ```

   (Ajustar el `where` si el nombre real del comercio demo en la base es
   distinto — confirmarlo con `select id, nombre from public.comercios;`.)

Sin esta fila, el usuario puede iniciar sesión correctamente (autenticación
válida) pero el dashboard muestra "Sin comercios asignados" (autorización
vacía) — comportamiento esperado, no un error.

## Permisos de lectura sobre las tablas existentes

El dashboard necesita `SELECT` de `service_role` sobre `comercios`,
`servicios`, `recursos` y `turnos`. Según `docs/estado-proyecto.md` de
`whatsapp-demo` (sección "Correcciones aplicadas"), `service_role` ya recibió
`GRANT ... TO service_role` sobre todas las tablas de `public` para que el
bot pudiera operar — el dashboard debería heredar ese mismo permiso sin
cambios adicionales. Si al probar contra la base real aparece
`permission denied for table <tabla>` (código `42501`), aplicar:

```sql
grant select on public.comercios, public.servicios, public.recursos, public.turnos to service_role;
```

Esto no se verificó contra la base real en esta sesión (no había
credenciales de Turnos cargadas) — ver limitaciones en
`docs/turnos/estado-proyecto.md`.
