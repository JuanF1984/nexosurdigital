# Configuración de Turnos

No incluye valores reales de secretos — solo nombres de variables y pasos.
Ver también `docs/mide/seguridad.md` para el mismo criterio aplicado a MIDE.

## Variables de entorno

```text
TURNOS_SUPABASE_URL
TURNOS_SUPABASE_ANON_KEY
TURNOS_SUPABASE_SECRET_KEY
```

| Variable | Uso | Dónde se lee |
|---|---|---|
| `TURNOS_SUPABASE_URL` | URL del proyecto de Supabase de Turnos (**distinto** del de MIDE) | `src/lib/turnos/supabase.ts`, `src/lib/turnos/supabase-auth.ts`, `src/proxy.ts` |
| `TURNOS_SUPABASE_ANON_KEY` | Clave anon/publishable de Turnos. Server-only en este proyecto: solo la usa el cliente de sesión (`getTurnosAuthServerClient`) para login/logout/`getUser()`. Nunca se le da el prefijo `NEXT_PUBLIC_`, así que Next.js nunca la inlinea en el bundle del navegador, aunque Supabase la considere segura para exponer | `src/lib/turnos/supabase-auth.ts`, `src/proxy.ts` |
| `TURNOS_SUPABASE_SECRET_KEY` | Service role key de Turnos. Server-only, bypassea RLS, se usa para todas las lecturas de negocio (`turnos`, `comercios`, `servicios`, `recursos`, `usuario_comercios`). Nunca se expone al cliente, nunca se loguea, nunca se devuelve en una respuesta | `src/lib/turnos/supabase.ts` |

Ninguna de las tres debe coincidir ni reutilizarse con `SUPABASE_URL` /
`SUPABASE_SECRET_KEY` de MIDE — son proyectos de Supabase distintos. `.env.example`
en la raíz del repo documenta esto mismo junto a las variables de MIDE.

## Configuración local

Ya agregado a `.env.local` (gitignored) con valores vacíos:

```text
TURNOS_SUPABASE_URL=
TURNOS_SUPABASE_ANON_KEY=
TURNOS_SUPABASE_SECRET_KEY=
```

Completar con los valores reales del proyecto de Supabase de Turnos (Project
Settings → API, en el dashboard de Supabase — **el de Turnos, no el de
MIDE**). Sin estos valores, `/turnos/login` muestra un aviso de "Turnos no
está configurado todavía" en vez de fallar silenciosamente o mostrar un
error críptico.

## Configuración en Vercel

Igual que las variables de MIDE (ver `docs/energy-event-api.md` para el
patrón general):

```bash
vercel env add TURNOS_SUPABASE_URL
vercel env add TURNOS_SUPABASE_ANON_KEY
vercel env add TURNOS_SUPABASE_SECRET_KEY
```

Recordar redeployar después de agregar o cambiar variables — Vercel solo las
inyecta en builds/deploys nuevos, no en un simple restart.

## Configuración de Supabase (proyecto de Turnos)

- Las tablas de negocio (`comercios`, `servicios`, `recursos`,
  `servicios_recursos`, `disponibilidad`, `excepciones_disponibilidad`,
  `turnos`, `sesiones_whatsapp`) ya existen — son del proyecto
  `Proyectos/whatsapp-demo`, no se crean ni se modifican desde acá.
- La tabla nueva `usuario_comercios` (autorización del dashboard) se agrega
  a mano, pegando el SQL de `docs/turnos/base-de-datos.md` en el SQL Editor
  del proyecto de Supabase de **Turnos**.
- Dar de alta el primer usuario del dashboard: pasos manuales en
  `docs/turnos/base-de-datos.md#cómo-dar-de-alta-el-primer-usuario-del-dashboard`.
- Verificar permisos de `service_role` sobre `comercios`/`servicios`/
  `recursos`/`turnos` si aparece `permission denied` al probar — ver
  `docs/turnos/base-de-datos.md#permisos-de-lectura-sobre-las-tablas-existentes`.

## Qué no se tocó

- No se modificó ninguna variable de entorno de MIDE (`SUPABASE_URL`,
  `SUPABASE_SECRET_KEY`, `MIDE_DEVICE_API_KEY`).
- No se modificó ninguna variable de `/api/energy-event`.
- No se tocó ninguna variable de `Proyectos/whatsapp-demo`
  (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `COMERCIO_SLUG`) ni su
  configuración de Vercel/Meta.
