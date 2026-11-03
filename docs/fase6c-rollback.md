# Rollback — Fase 6c (RLS en producción sin romper catálogo/login)

**Objetivo:** devolver producción al comportamiento anterior en **menos de 5 minutos** si el
catálogo público, el login o cualquier ruta autenticada falla tras el despliegue del fix de
RLS (PR #18, commits `801193e` → `fbd241c`).

**Qué cambia este fix, para saber qué revertir:**

| Cambio | Dónde vive | Cómo se revierte |
|---|---|---|
| La API conecta como `app_rls_user` en vez de `postgres` | Variable `DATABASE_URL` de Railway | Nivel 2 |
| `publicTenantContext` fija el tenant de plataforma en rutas de catálogo | Código (`backend/`) | Nivel 1 |
| Login usa `app_usuario_para_login` (SECURITY DEFINER) | Código + migración `124` | Nivel 1 |
| Migraciones `115`/`120` fuerzan RLS en toda tabla con `tenant_id` | Base de datos | Nivel 3 |

La migración `124` es **aditiva** (crea una función). Dejarla aplicada no rompe nada: no hay
que revertirla para recuperar servicio.

---

## Nivel 1 — Redeploy del despliegue anterior (≈ 60 s)

Railway conserva las imágenes ya construidas. Es el camino más rápido y no toca la base.

1. En el panel de Railway → servicio `glowapp-api` → entorno `production` → pestaña
   **Deployments**.
2. Localizar el despliegue **anterior al fix** (el último `SUCCESS` cuyo commit sea
   `bb6b8c6` o anterior) y pulsar **Redeploy**.

Equivalente por API:

```graphql
# 1) listar para encontrar el deploymentId anterior
query { deployments(first: 10, input: {serviceId: "fd9f3c76-6ddd-46f2-9790-763d556094e2",
        environmentId: "d5672c2a-cc56-4649-9efc-c9fa401f3c08"}) {
  edges { node { id status createdAt meta } } } }

# 2) redesplegar ese id
mutation { deploymentRedeploy(id: "<DEPLOYMENT_ID_ANTERIOR>") }
```

---

## Nivel 2 — Volver la conexión al rol admin (≈ 3 min)

Si el problema es de **permisos** (403/500 por `permission denied`, catálogo vacío por RLS),
revertir el rol devuelve el comportamiento previo de inmediato. La RLS sigue activa en las
tablas, pero `postgres` es superusuario y la ignora: **esto desactiva el aislamiento
multi-tenant**. Es una medida de contención, no una solución; hay que volver al rol
restringido en cuanto se corrija la causa.

```bash
railway link -p glowapp -e production
railway variables --service glowapp-api --kv | grep DATABASE_URL   # copiar solo el host y el usuario
```

Reponer la URL con el rol administrador (`postgres`) en `DATABASE_URL` y redesplegar.

⚠️ **Nunca** dejar este estado más de lo necesario: vuelve a abrir la fuga entre inquilinos
que P-092 describía.

---

## Nivel 3 — Revertir las migraciones de RLS (≈ 10 min, último recurso)

Solo si las políticas impiden operar incluso con `app_rls_user`. Se hace por tabla, no en
bloque:

```sql
-- por tabla afectada
ALTER TABLE <tabla> NO FORCE ROW LEVEL SECURITY;
-- si además hay que desactivarla por completo
ALTER TABLE <tabla> DISABLE ROW LEVEL SECURITY;
```

Esto **no** borra las políticas: al reactivar `FORCE`, vuelven a aplicarse.

---

## Verificación tras cualquier rollback

```bash
U=https://glowapp-api-production.up.railway.app
curl -s -H "X-App-Audience: client" $U/api/health
curl -s -H "X-App-Audience: client" $U/api/providers | head -c 200
curl -s -H "X-App-Audience: client" $U/api/products  | head -c 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST $U/api/auth/login \
  -H "Content-Type: application/json" -H "X-App-Audience: client" \
  -d '{"email":"demo.ana@glowapp.test","password":"DemoGlow2026!"}'
```

Criterio de servicio restablecido: `/api/health` 200 y **login 200**. Los `count` del catálogo
dependen de los datos de cada entorno (ver nota de tenancy abajo), así que no son criterio de
rollback por sí solos.

Y para saber con qué rol está conectada la API:

```sql
SELECT usename, count(*) FROM pg_stat_activity
WHERE datname = current_database() GROUP BY 1 ORDER BY 2 DESC;
```

---

## Nota de tenancy (importante para interpretar el catálogo)

El catálogo público se sirve con el **tenant de plataforma** (`tenants.es_plataforma`). En
producción ese tenant es `1`, pero los 16 productos sembrados tienen `tenant_id = 2`, así que
`/api/products` devuelve 0 aunque la tabla tenga 16 filas. **No es un fallo de RLS**: es un
desajuste entre el tenant de los datos y el tenant de plataforma. Se corrige reasignando los
datos o decidiendo si el catálogo público debe incluir productos de salones.

Comprobación:

```sql
SELECT id FROM tenants WHERE es_plataforma;                      -- tenant de plataforma
SELECT tenant_id, count(*) FROM productos GROUP BY 1;            -- a quién pertenecen
```
