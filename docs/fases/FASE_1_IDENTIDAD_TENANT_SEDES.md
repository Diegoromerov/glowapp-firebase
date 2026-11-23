# Cierre de Fase 1 — Identidad SaaS y sedes

**Estado:** cambios implementados en el árbol local; migración 189 pendiente de ejecutarse en la base objetivo y de conciliación posterior.

**Alcance de este cierre:** código backend, migración y documentación. No se desplegó el backend ni se modificó una base remota.

## Objetivo

Hacer explícita la relación entre cada sede (`salones`) y su identidad comercial SaaS (`business_profiles`), y respetar la sede seleccionada por el usuario en cada petición. Se conserva el modelo de membresías canónico existente.

## Situación encontrada

- Las migraciones 113/114 crearon perfiles comerciales y membresías canónicas; la 118 retiró el uso operativo de `salon_miembros`.
- Aun así, varios servicios reconstruían el perfil concatenando `salon-` con el ID entero de la sede. Analítica del propietario incluso extraía el ID desde el texto del perfil.
- La app ya enviaba `x-active-salon-id`, pero el middleware SaaS normalmente resolvía la membresía más reciente y no aplicaba esa selección.
- Hay dos identificadores distintos que deben seguir separados: `salones.tenant_id` es un entero legado hacia `tenants`; `business_profiles.tenant_id` es texto usado por el SaaS. Esta fase no los convierte ni los sincroniza.

## Cambios realizados

1. **Migración aditiva 189** (`backend/migrations/189_explicit_salon_business_profile.sql`): agrega `salones.business_profile_id`, completa sedes existentes mediante la convención histórica, crea FK e índice. La columna queda nullable para permitir detectar excepciones antes de endurecer el esquema.
2. **Aprovisionamiento:** `salonIdentity` y `/api/saas/bootstrap` registran el vínculo explícito al crear/asociar el perfil y fallan si la sede ya está vinculada a otro perfil.
3. **Selección de contexto:** `saasContext` y el bootstrap leen `x-active-salon-id`, validan que sea entero positivo y limitan la resolución a una membresía activa asociada a esa sede. La respuesta SaaS incluye `salonId`.
4. **Consumidores migrados:** guards de propietario, equipo/membresías, perfil de salón, controladores de caja y operación, dashboard de propietario, conciliación de autenticación y resumen operativo de Aura consultan `salones.business_profile_id`.
5. **Contratos de prueba actualizados:** los dobles de DB reflejan la relación nueva y el middleware tiene casos para selección e ID de sede inválido.
6. **Registro:** se documentó la migración 189 en `backend/migrations/REGISTRY.md` y se actualizó el estado del plan general.

## Modelo resultante y límites

```text
salones.id (sede operativa)
    └── salones.business_profile_id (relación explícita)
            └── business_profiles.id (identidad comercial SaaS)
                    └── memberships (usuarios y rol canónico)
```

La provisión actual sigue creando una identidad por salón, de modo que no se habilita todavía compartir equipo/permisos entre múltiples sedes de un mismo negocio. Aunque la FK permite que varias sedes apunten a un perfil, esa modalidad debe esperar a la Fase 3, que definirá membresías con alcance de sede y permisos efectivos. Esta restricción evita que una membresía tenant-level conceda acceso accidental a todas las sedes compartidas.

La política RLS heredada continúa usando `tenantContext` y `salones.tenant_id`; esta fase no cambia ese contrato ni afirma que todas las tablas estén aisladas por `business_profile_id`. La unificación segura del contexto RLS requiere inventario y migración específica de políticas por tabla.

## Verificación y estado operativo

- Inspección estática: se revisaron consultas y referencias bajo `backend/src`; no deben quedar consultas de runtime que deriven una relación desde `left('salon-' || ...)` o que extraigan el ID con `substring(bp.id ...)`. La convención `salon-<id>` permanece solo para crear identidades históricas nuevas y para el backfill de datos.
- Se actualizaron pruebas unitarias pertinentes; **no se ejecutó la suite**, ni una base remota, ni el despliegue.
- El runner `backend/src/config/migrationRunner.js` recoge archivos `.sql` por orden alfabético en el arranque y registra su checksum. La 189 se aplicará cuando se despliegue/inicie el backend con el archivo incluido.
- Después de aplicarla, revisar `/api/health` y la tabla `schema_migrations`, y medir:

```sql
SELECT COUNT(*) AS sedes_sin_perfil
FROM salones
WHERE business_profile_id IS NULL;

SELECT business_profile_id, COUNT(*) AS sedes
FROM salones
WHERE business_profile_id IS NOT NULL
GROUP BY business_profile_id
HAVING COUNT(*) > 1;
```

La segunda consulta debe mantenerse en cero hasta que Fase 3 defina membresía y autorización por sede. Si aparecen sedes sin perfil, se deben asociar manualmente mediante datos verificados; no se debe inventar identidad a partir de `salones.tenant_id`.

## Riesgos y decisiones

- **Compatibilidad:** los lectores ahora requieren que la migración 189 esté aplicada. Desplegar solo código antes de migrar la base causaría errores `column business_profile_id does not exist` en rutas afectadas. Aplicar el SQL antes o junto al backend que lo consume.
- **Aprovisionamiento:** la creación de identidad y su enlace deben quedar dentro de la misma transacción en el flujo de creación del salón. Revisar/garantizar ese límite antes de ampliar la provisión a más rutas.
- **Sedes compartidas:** no se debe vincular un perfil existente a otra sede hasta terminar permisos por sede de la Fase 3.
- **Backfill:** usa el ID histórico que ya empleaban 113/114; no resuelve casos huérfanos ni perfiles con IDs personalizados. La columna nullable deja esos casos visibles para conciliación.

## Reversión

La migración es aditiva. Para revertir solo el código, volver a la revisión anterior y mantener la columna, FK e índice sin uso. No eliminar la columna mientras existan versiones que la consulten o haya datos que deban conservarse. Si se decide retirar el esquema más adelante, hacerlo en una migración nueva tras confirmar dependencias y respaldar la base.

## Pendiente para cerrar la fase en producción

1. Desplegar el backend con la 189 y verificar que quedó registrada.
2. Revisar `sedes_sin_perfil` y duplicidades de perfil por sede; investigar cualquier excepción.
3. Confirmar flujos de selección de sede para un propietario con más de una sede y para un miembro invitado.
4. Mantener la relación uno-a-uno hasta entregar Fase 3.
