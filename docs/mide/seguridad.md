# Seguridad de MIDE

## Separación ESP32 / API / Supabase

```text
ESP32 / dispositivo MIDE → API propia (/api/mide/*) → Supabase
```

El dispositivo nunca tiene ni usa credenciales de Supabase. Todas las
credenciales privilegiadas viven exclusivamente en el servidor (variables
de entorno de la API), nunca en el firmware ni en el frontend.

## Variables de entorno (solo nombres)

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
MIDE_DEVICE_API_KEY
```

- `SUPABASE_URL` / `SUPABASE_SECRET_KEY`: usadas únicamente por
  `src/lib/mide/supabase.ts`, en el servidor. `SUPABASE_SECRET_KEY` es la
  service role key de Supabase — nunca se expone al cliente, nunca se
  loguea, nunca se devuelve en una respuesta HTTP.
- `MIDE_DEVICE_API_KEY`: secreto compartido que el dispositivo envía como
  `Authorization: Bearer <MIDE_DEVICE_API_KEY>`. Independiente de
  `DEVICE_API_KEY` (usada por `/api/energy-event`) — no se comparten ni se
  reutilizan entre sí.

Ningún valor real de estas variables aparece en este documento, en ningún
otro archivo de `docs/mide/`, en la migración SQL, ni en el seed de
desarrollo. `.env.local` está en `.gitignore` (ver raíz del proyecto);
`.env.example` solo lista nombres de variables, con valores vacíos.

## RLS y permisos de `service_role`

Las cuatro tablas de MIDE tienen RLS habilitado y **sin políticas
públicas**. El único acceso es servidor → Supabase con la service role key,
que bypassea RLS por diseño de Supabase. No hay, ni debe agregarse, ninguna
política que permita acceso `anon` o `authenticated` directo desde el
navegador o el dispositivo.

Sobre el proyecto de Supabase real ya se aplicaron, con criterio de mínimo
privilegio, únicamente los permisos que la API efectivamente usa hoy
(`devices`: SELECT + UPDATE; `measurements`: INSERT; `events`: INSERT;
`device_config`: SELECT) — verificado en funcionamiento contra esa misma
base. `service_role` **no** tiene permiso de lectura sobre `measurements`
ni sobre `events`, a propósito, porque ninguna ruta actual lo necesita.
Detalle completo en
[`base-de-datos.md`](./base-de-datos.md#permisos-reales-en-supabase).

Cuando exista login de MIDE (futuro, no implementado):

```text
usuario autenticado → cliente/organización → dispositivos asignados
```

recién ahí tendría sentido evaluar políticas RLS para `authenticated`
scoped por dueño. Usuarios, clientes, organizaciones, planes y permisos de
dashboard no existen todavía en este cambio.

## Autenticación de dispositivos: estado actual y futuro

**Estado actual (este cambio):** un secreto único compartido
(`MIDE_DEVICE_API_KEY`) enviado como Bearer token, comparado con
`crypto.timingSafeEqual` sobre un hash SHA-256 (mismo patrón ya usado por
`/api/energy-event`, implementado independiente en
`src/lib/mide/auth.ts`). `deviceId` por sí solo **nunca** se trata como
autenticación suficiente — siempre se exige el Bearer token además de
validar que el `deviceId` exista. Este mecanismo ya fue probado
funcionando contra el proyecto de Supabase real (ver
[`api.md`](./api.md#validación-contra-la-base-real)), pero debe
documentarse explícitamente como un **mecanismo de prototipo / primera
etapa**, no como la solución final para un despliegue con muchos
dispositivos en campo: un único secreto compartido entre todos los
dispositivos significa que, si se filtra, hay que rotarlo para todos a la
vez, y no permite revocar un dispositivo individual.

**Pendiente, documentado a propósito y no implementado ahora** (se decidió
no implementar HMAC todavía porque el flujo de altas de dispositivo y
distribución de secretos por dispositivo no está definido; agregarlo ahora
sería sobreingeniería sin ese contexto):

- Secreto único por dispositivo (en vez de uno compartido global).
- Firma HMAC del payload.
- Timestamp + tolerancia de reloj.
- Nonce y protección contra replay.

La API está organizada para poder incorporar esto después sin romper el
contrato actual: la validación de autenticación está aislada en
`src/lib/mide/auth.ts`, separada de la lógica de cada ruta, así que
cambiar el mecanismo de auth no debería tocar la validación de payload ni
el acceso a Supabase.

No se crearon secretos ficticios hardcodeados en ningún archivo — todos los
secretos, presentes o futuros, se leen de variables de entorno.

## Qué no debe almacenarse ni documentarse

- Valores reales de `SUPABASE_URL`, `SUPABASE_SECRET_KEY` ni
  `MIDE_DEVICE_API_KEY` en ningún archivo del repositorio (código,
  migraciones, seed, docs).
- Contenido real de `.env.local` en la documentación o en el historial de
  git.
- Datos personales o información sensible de clientes/dispositivos en la
  migración de esquema (el seed de desarrollo solo registra el dispositivo
  de prototipo `mide-frio-001`, sin datos personales).
- Secretos en logs: los `console.error` de las rutas `/api/mide/*` solo
  registran mensajes de error de Supabase o strings fijos, nunca el cuerpo
  del request ni las credenciales.
