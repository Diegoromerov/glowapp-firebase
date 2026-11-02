# Migraciones manuales (NO se aplican en el arranque)

El runner de arranque del backend aplica todo lo que hay en `backend/migrations/`.
Estos dos archivos son **deliberadamente** una migración de datos y una de aislamiento
que **no** deben ejecutarse solas en un despliegue: requieren ventana, copia de
seguridad y mediciones antes/después. El directorio `manual/` **no** es leído por el
runner (lee solo el nivel superior), así que nada de esto se dispara automáticamente.

Auditoría de origen: **A360-2026-09-22**, hallazgos **C-09** (RLS inerte) y **C-10**
(backfill histórico a un solo tenant `demo`).

---

## 1. `069_force_rls_strict_isolation.sql` — C-09

**Qué era el problema.** `058` hacía `ENABLE ROW LEVEL SECURITY` sin `FORCE`, y el rol
que usa la aplicación es **el dueño de las tablas** (las crea ella misma al arrancar):
un dueño bypassea RLS salvo que se fuerce. Medido en la auditoría: `force=false`.
La política única usaba `current_setting('app.tenant_id')` **sin** `missing_ok`, así que
sin contexto lanzaba error en vez de devolver vacío; y no había `WITH CHECK`.

**Riesgo de aplicarla (por eso está aquí).** Con `FORCE` activo, cualquier conexión que
**no** haya fijado `app.tenant_id` obtiene **0 filas** en las tablas con `tenant_id`.
Hoy la app tiene dos caminos de datos y solo uno pasa por `authMiddleware` (el que hace
`set_config`):

| Camino | ¿Fija el contexto de tenant? |
|---|---|
| `pool.query` tras `authMiddleware` (`backend/src/middleware/auth.js`) | Sí (con `is_local=false`, ver nota) |
| Sequelize (`src/models`, usado por `bookingController`, pagos) | **No** |
| Scripts y jobs (`src/jobs`, `scratch/`) | **No** |

**Nota sobre `auth.js`:** el `set_config(..., false)` fija el parámetro a nivel de
**sesión** en una conexión arbitraria del pool y nunca se resetea. Es correcto para RLS
solo si la consulta siguiente cae en esa misma conexión, y eso no está garantizado.
**Prerequisito obligatorio antes de aplicar esto:** propagar el contexto por petición
con una sola conexión (transacción por request con `SET LOCAL`, o un wrapper en
`db.js` que enrute las consultas a un cliente con contexto, más un hook equivalente
para Sequelize). Si no, `FORCE` rompe producción con lecturas vacías.

**Procedimiento**

```bash
# 0. Backup fuera de banda
pg_dump "$DATABASE_URL" -Fc -f backup_pre_069_$(date +%F).dump

# 1. Medir el estado actual (guardar la salida)
psql "$DATABASE_URL" -c "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r';"

# 2. Aplicar
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/manual/069_force_rls_strict_isolation.sql

# 3. Verificar: con contexto, la app ve sus filas; sin contexto, ve 0 (es lo esperado)
psql "$DATABASE_URL" -c "BEGIN; SELECT set_config('app.tenant_id','1',true);
  SELECT count(*) FROM bookings; COMMIT;"
```

**Rollback:** `ALTER TABLE <t> NO FORCE ROW LEVEL SECURITY;`

---

## 2. `070_reassign_tenant_id_by_owner.sql` — C-10

**Qué era el problema.** La `057` hizo un `UPDATE ... SET tenant_id = <demo>` sobre todo
el histórico sin dueño determinable, así que todos los datos legacy quedaron en el mismo
tenant: cualquiera con ese `tenant_id` ve datos de todos.

**Por qué no se reescribe la `057`.** Ya se ejecutó: `WHERE tenant_id IS NULL` no vuelve
a encontrar filas, y con `schema_migrations` una migración aplicada no se re-ejecuta.
Hace falta una migración **nueva** que reasigne consultando al dueño real
(`salones.id_dueno`, `salon_miembros`, y el cliente/prestador de cada booking).

**Procedimiento**

```bash
pg_dump "$DATABASE_URL" -Fc -f backup_pre_070_$(date +%F).dump

# ANTES (guardar): cuántas filas hay por tenant
psql "$DATABASE_URL" -c "SELECT t.slug, count(*) FROM usuarios u
  LEFT JOIN tenants t ON t.id=u.tenant_id GROUP BY 1 ORDER BY 2 DESC;"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/manual/070_reassign_tenant_id_by_owner.sql

# DESPUÉS: el conteo de 'demo' debe bajar
```

**Lo que quede en `demo` es una decisión de negocio**, no un borrado automático:
son filas sin dueño atribuible. Opciones: depurar, marcar como legacy, o mover a un
tenant de cuarentena con revisión manual.

---

## 3. Nota sobre el historial de git (C-02)

La purga del historial (`git filter-repo` / BFG + force-push) **no** se ejecutó: hay 11
worktrees de trabajo activos que quedarían invalidados, y el force-push necesita una
ventana coordinada con todo el equipo. Ver la sección correspondiente del informe de
remediación para el procedimiento y los secretos a **rotar** (rotar es lo urgente;
purgar es lo que evita que vuelvan a aparecer).
