# Onboarding SaaS — Fase 4: equipo y permisos

**Corte de evidencia:** 25 de noviembre de 2026  
**Estado:** abierta; **75 % estimado de criterios de salida verificados**. Este porcentaje es una estimación ponderada del cierre de la Fase 4 del plan de *onboarding* (equipo y permisos); no es el porcentaje global de las siete fases.  
**Producción:** Railway `glowapp-api`, commit `58a5e5fe138ce4e69b9da0565f8e871a34b966ad`, despliegue `6483a9d8-dcc0-4526-9fb0-6ff62511eb6c` (`SUCCESS`).

## Objetivo y criterio de cierre

Incorporar al personal según el nivel del salón, con invitaciones, aceptación, roles y permisos; impedir que se excedan los asientos incluidos en el plan.

La fase se cierra cuando la invitación se entrega y acepta con el correo correcto, se rechaza una cuenta distinta, se completan las pruebas de roles y alcance por sede, y las invitaciones, reactivaciones y concurrencia respetan el límite de asientos.

## Implementación desplegada

- `memberships` es la fuente canónica para equipo, roles, invitaciones y estados.
- OWNER cambia roles. ADMIN gestiona invitaciones y estados, pero no cambia roles ni propiedad. MANAGER y VIEWER tienen permisos operativos inferiores.
- Las invitaciones guardan hash del token, vencen a los siete días y se vinculan al correo invitado.
- Invitaciones pendientes y miembros activos consumen asientos; los caminos de alta/reactivación usan bloqueo de tenant.
- La auditoría de membresías es append-only.
- La migración 200 configura RLS habilitado y forzado para `memberships` y `membership_audit_logs`, con cinco y cuatro políticas, respectivamente.

## Evidencia de producción

- Railway despliega el commit `58a5e5f`; el arranque registra `app_rls_user` con `BYPASSRLS=false` y aplicación exitosa de `200_saas_memberships_rls.sql`.
- `/api/health` respondió `OK`, con PostgreSQL disponible, sin datos fabricados, 72 migraciones registradas y migración 200 como última aplicación.
- PostgreSQL confirma RLS habilitado y forzado en ambas tablas. El propietario consulta su equipo y las funciones de búsqueda/lectura de equipo funcionan dentro del perfil activo.
- Transacciones temporales revertidas comprobaron reglas OWNER/ADMIN/MEMBER y auditoría inmutable.
- **Prueba transaccional de MANAGER y VIEWER:** se agregaron dos membresías sintéticas temporales al salón QA 17; bajo `app_rls_user`, ambos roles solo leyeron las tres filas del equipo de ese salón. `app_saas_can_manage_members=false` y `app_saas_is_owner=false` para ambos. La transacción terminó en `ROLLBACK`; una consulta posterior confirmó cero membresías de prueba persistentes para los usuarios 133 y 131.
- Estas consultas verifican RLS y helpers PostgreSQL; **no equivalen a una prueba HTTP autenticada** de los endpoints por cada rol.
- La evidencia de release registra seis suites focalizadas con **38/38 pruebas aprobadas**, incluida la suite de rutas y la de membresías. El API y el panel están desplegados con checks exitosos.

## Avance de la fase 4

**75 % estimado; fase abierta.** Los pesos miden criterios verificados, no líneas de código. Las pruebas transaccionales mejoran la evidencia de PostgreSQL, pero no completan la verificación de la matriz en las rutas API reales.

## Pendientes para cerrar

1. Invitación por API, entrega de correo, aceptación con cuenta correcta, rechazo con cuenta distinta, expiración y reenvío.
2. Matriz HTTP autenticada para MANAGER y VIEWER, incluyendo alcance por sede.
3. Límite de asientos, concurrencia y reactivación mediante las rutas de producción.

El QA documentado usa correos `example.com`, que no reciben mensajes. No se envió ningún correo durante estas pruebas. Para cerrar ese recorrido hace falta una cuenta GlowApp registrada y un buzón QA autorizado.

## Aclaración de numeración

Hay dos planes distintos. `PLAN_RECONSTRUCCION_SAAS_POR_FASES.md` numera la **Fase 4 como Agenda y reservas**. El plan posterior **Plan de trabajo por fases para el onboarding SaaS** numera la **Fase 4 como Equipo y permisos**. Este informe y la siguiente tabla corresponden al plan de onboarding; no se deben transferir estados de un plan al otro.

## Auditoría estadística de las siete fases del onboarding

**No existe una medición automática del avance en el sistema.** Por eso no es defendible presentar un porcentaje de código como si fuera “real”. La tabla aplica una rúbrica común a evidencia de informes y despliegues.

Cada fase se evalúa en cinco grupos: diseño/alcance, implementación, integración backend, verificación funcional/seguridad y operación/publicación. Cada grupo vale 20 puntos: **20** con evidencia explícita de terminado, **10** si está parcialmente implementado o publicado con validación pendiente, **0** si no hay evidencia suficiente. “Sin evidencia” no implica que la función no exista; indica que los documentos examinados no prueban ese criterio.

| Fase del onboarding | Diseño / alcance | Implementación | Integración backend | Verificación | Operación / publicación | Avance documentable | Evidencia y brecha |
|---|---:|---:|---:|---:|---:|---:|---|
| 1. Entrada confiable | 20 | 20 | 20 | 20 | 10 | **90 %** | Alta, bootstrap, reintento idempotente y protección de Caja verificados en producción; falta inspección visual integral y caso heredado. [Informe fase 1](fases/ONBOARDING_FASE_1_PUERTA_SAAS.md). |
| 2. Configuración inicial del salón | 20 | 20 | 20 | 20 | 10 | **90 %** | Producción: perfil/horario persistieron en QA, reintento no duplicó salón, anónimo 401, usuario sin membresía 403, servicio QA creado; backend, migración 198 y cliente publicados. Solo queda inspección visual manual móvil/escritorio. [Informe fase 2 vigente en main](https://github.com/Diegoromerov/glowapp-firebase/blob/main/docs/fases/ONBOARDING_FASE_2_CONFIGURACION_SALON.md). |
| 3. Plan y límites claros | 20 | 20 | 10 | 10 | 10 | **70 %** | Catálogo publicado/consumido y controles principales; faltan mapa completo de capacidades a rutas y pruebas integrales de cuotas/cambios. [Informe técnico fase 2](fases/FASE_2_CATALOGO_ENTITLEMENTS_CUOTAS.md), [auditoría comercial fase 7](fases/FASE_7_PAQUETES_Y_LANZAMIENTO.md). |
| 4. Equipo y permisos | 20 | 20 | 20 | 10 | 5 | **75 %** | Producción: migración 200/RLS, seis suites focalizadas con 38/38 pruebas aprobadas y consultas transaccionales de roles. Faltan invitación/correo E2E, matriz HTTP completa y cupos concurrentes/reactivación por rutas. Evidencia en este informe y despliegue Railway vigente. |
| 5. Puesta en marcha operativa | 10 | 10 | 10 | 0 | 0 | **30 %** | Agenda, caja e inventario están desplegados; no hay evidencia de guía integrada de primeros pasos ni de primera reserva completada en un recorrido guiado del onboarding. |
| 6. Facturación y cambios de plan | 10 | 20 | 20 | 10 | 10 | **70 %** | Checkout, suscripciones, facturas y cancelación existen; checkout fija `trialDays: 0`. No se documentan recorridos E2E completos de renovación, comprobante, cancelación y recuperación de pago. |
| 7. Seguimiento y crecimiento | 20 | 20 | 20 | 10 | 10 | **80 %** | Analítica y primera entrega de fidelización aparecen desplegadas; faltan validaciones autenticadas productivas, automatización/reversos de puntos y definición comercial de complementos. [Informe técnico fase 6](fases/FASE_6_CRECIMIENTO_ANALITICA_IA.md). |
| **Media simple** |  |  |  |  |  | **72 %** | (90 + 90 + 70 + 75 + 30 + 70 + 80) / 7 = 72,1 %, redondeado al entero más cercano. No pondera esfuerzo ni dependencias. |

**Interpretación:** 72 % es cumplimiento de criterios documentados con esta rúbrica, no porcentaje de código ni telemetría automática. La Fase 4 de onboarding (Equipo y permisos) permanece **abierta, 75 %**, conforme a su informe productivo. Railway consultado el 25 de noviembre de 2026 muestra API y panel `SUCCESS`, sin cambios pendientes; la fase 2 también tiene backend, migración y cliente publicados con QA funcional, y resta la revisión visual.

La numeración corresponde al plan de onboarding. La fase técnica 5 (operación comercial) no cierra automáticamente la Fase 5 de onboarding (primera operación guiada).
