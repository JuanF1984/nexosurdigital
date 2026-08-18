# Migraciones MIDE

Este proyecto no usaba migraciones SQL hasta ahora. Las tablas de MIDE
(`devices`, `measurements`, `events`, `device_config`) ya fueron creadas
**manualmente** en el proyecto de Supabase real.

- `migrations/20260818000000_mide_schema.sql` reconstruye ese esquema
  (tablas, constraints, índices, triggers de `updated_at`, RLS, y la función
  `mide_ingest_report`) a partir de las notas de diseño del proyecto, **no**
  de una introspección directa de la base real (no había credenciales
  disponibles al escribirla). Está escrita de forma defensiva
  (`if not exists`, `or replace`, `drop ... if exists`) para poder
  reejecutarse sin romper nada, pero **antes de correrla contra el proyecto
  existente hay que diffearla contra el esquema real** (por ejemplo con
  `supabase db diff` si se instala el CLI, o revisando a mano en el dashboard
  de Supabase) para confirmar que los nombres de columnas/constraints
  coinciden.
- `seed.sql` registra el dispositivo de desarrollo `mide-frio-001` y su
  configuración inicial. Está separado del esquema a propósito: no debe
  correrse en producción, solo en un entorno de desarrollo nuevo.

## Uso (con Supabase CLI, si se instala)

```bash
supabase db push          # aplica las migraciones pendientes
supabase db reset         # entorno local: recrea esquema + corre seed.sql
```

Sin el CLI, el SQL de ambos archivos puede pegarse directamente en el SQL
Editor del dashboard de Supabase — revisando primero que no colisione con
objetos ya existentes en el proyecto real.

## Por qué no se tocó nada existente

`/api/energy-event` no usa base de datos en absoluto (envía un email vía
Resend y listo), así que esta carpeta y estas migraciones no tienen ninguna
relación ni dependencia con esa ruta.
