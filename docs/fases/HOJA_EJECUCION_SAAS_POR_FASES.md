# Hoja de ejecución del área SaaS GlowApp

**Propósito:** convertir el plan de reconstrucción SaaS en una secuencia de trabajo ejecutable, con dependencias y condiciones claras para cerrar cada etapa.

**Regla de avance:** cerrar y documentar una fase antes de iniciar la siguiente. “Implementado localmente”, “desplegado” y “validado en producción” son estados distintos y no se deben intercambiar.

## Estado inicial basado en documentación remota

| Fase | Estado registrado | Trabajo pendiente / criterio siguiente |
|---|---|---|
| 0. Línea base | Inventario y decisiones arquitectónicas documentadas previamente | Consolidar informe de línea base con mapa de módulos, rutas, datos, guards y dependencias. |
| 1. Identidad de negocio y sedes | Desplegada y conciliada en producción según su informe (migración 189) | Mantener la restricción de no compartir identidad entre sedes sin autorización por sede. Reauditar si cambia aprovisionamiento o esquema. |
| 2. Catálogo, entitlements y cuotas | Catálogo v1 publicado; API y Hosting desplegados, según el informe | Ejecutar integración PostgreSQL/concurrencia; conciliar planes y llaves API ya existentes; documentar integraciones aún no instrumentadas. |
| 3. Membresías, roles y permisos | Informe remoto afirma despliegue en producción y migración 190 aplicada | Completar verificación controlada de correo/aceptación/RLS y revisar rutas operativas heredadas que aún usen roles o membresías antiguas. |
| 4. Agenda y reservas | Pendiente/en ejecución posterior al despliegue de fase 3 | No cerrar hasta normalizar ciclo de reserva, cuotas, sede y compatibilidad cliente/proveedor. |
| 5. Operación comercial | Pendiente | Integrar caja, inventario, recursos y tienda con permisos, auditoría e idempotencia. |
| 6. Crecimiento y herramientas avanzadas | Pendiente | Analítica, fidelización, Academia e IA como módulos medibles y autorizados. |
| 7. Paquetes y salida comercial | Pendiente | Empaquetar solo capacidades verificadas y alinear catálogo, onboarding, cobro y límites. |

> Los estados anteriores resumen informes presentes en la rama principal consultada; no sustituyen una consulta en vivo al despliegue ni una validación funcional de producción. Fase 3 aparece como desplegada, pero su informe conserva verificaciones operativas abiertas.

## Fase 0 — Línea base y decisiones

**Objetivo:** fijar el mapa técnico y comercial que guiará la integración.

**Trabajo ejecutable:** inventariar onboarding, salones/sedes, catálogo, planes, membresías, reservas, caja, inventario, tienda y herramientas avanzadas. Para cada función, registrar rutas, tablas, guardas, clientes, fuente de entitlement y estado de producción. Clasificarla como reutilizar, adaptar, refactorizar o excluir. Confirmar arquitectura de monolito modular y modelo tenant/sede.

**Entregable:** docs/fases/FASE_0_LINEA_BASE.md, con diagrama actual y objetivo, inventario por módulo y decisiones abiertas.

**Cierre:** cada módulo candidato tiene clasificación, dependencias y responsable; no quedan reglas críticas de tenant/plan sin resolver.

## Fase 1 — Identidad de negocio y sedes

**Objetivo:** que SaaS y operación del salón se resuelvan desde una identidad explícita de negocio y sede.

**Estado registrado:** cerrada/desplegada, según FASE_1_IDENTIDAD_TENANT_SEDES.md.

**Invariantes que se preservan:** selección explícita de sede activa; prevención de cruces de tenant/sede; no compartir perfiles entre sedes hasta completar autorización por sede; conservar la distinción entre salones.tenant_id y business_profiles.tenant_id.

**Cierre documentado:** el informe registra migración 189 y consultas productivas con cero sedes sin perfil o perfiles compartidos. Reauditar si cambian esquema, asignaciones o aprovisionamiento.

## Fase 2 — Oferta, entitlements y cuotas

**Objetivo:** que catálogo, backend y pantallas presenten y apliquen las mismas capacidades y límites.

**Estado registrado:** catálogo v1 publicado, según FASE_2_CATALOGO_ENTITLEMENTS_CUOTAS.md; quedan tareas de verificación comercial/técnica.

**Secuencia pendiente:**

1. Preparar pruebas PostgreSQL de conteo, idempotencia, reintentos y concurrencia para reservas, asientos e integraciones.
2. Contrastar planes y llaves API de tenants existentes contra catálogo v1; producir lista de excepciones y transición sin alterar cuentas silenciosamente.
3. Confirmar qué integraciones se miden y enumerar las que no pasan por API keys.
4. Decidir alertas de consumo y complementos como trabajo futuro; no anunciarlos hasta implementarlos.

**Cierre ampliado:** cuotas probadas concurrentemente, cuentas actuales conciliadas y política comercial de transición aprobada. Estas tareas completan preparación comercial, aunque el catálogo ya esté publicado.

## Fase 3 — Membresías, roles y permisos

**Objetivo:** mantener una sola fuente de verdad para equipo, permisos, roles operativos, invitaciones y asientos.

**Estado registrado:** informe remoto indica despliegue de backend y migración 190 en producción. El mismo informe deja validaciones operativas pendientes.

**Secuencia de cierre operativo:**

1. En un ambiente controlado, validar envío, aceptación con correo correcto, rechazo por correo distinto, expiración y reenvío.
2. Verificar RLS y que cada acción se vincule al tenant/sede y usuario correctos.
3. Probar capacidad de asientos al límite y altas/reactivaciones concurrentes.
4. Verificar cambios de rol, suspensión, reactivación, baja y registros de auditoría.
5. Inventariar rutas heredadas que aún autoricen con salon_miembros o roles del usuario y migrar las que queden fuera del guard canónico.
6. Registrar resultados observados, despliegues y rollback en FASE_3_MEMBRESIAS_ROLES.md.

**Cierre:** API deniega acciones no permitidas; asientos coinciden con el catálogo; flujo de invitación, correo, expiración y auditoría funcionan; apps y API coinciden; los pendientes heredados están resueltos o delimitados con plan.

## Fase 4 — Agenda y reservas

**Objetivo:** integrar agenda, servicios, disponibilidad y reservas bajo tenant, sede, roles y cuota comunes.

**Trabajo:** normalizar ciclo de reservar, reprogramar, cancelar, pagar, no-show y reseñar; asociar cada lectura/escritura a tenant/sede; aplicar cuota central idempotente; adaptar apps cliente/proveedor sin duplicar fuentes; instrumentar recordatorios y costes.

**Entregables:** contrato de reserva, rutas adaptadas, estados y reglas de cuota; compatibilidad móvil y plan de reversión.

**Cierre:** IDs manipulados no cruzan sedes; cuota y uso coinciden; personal ve solo las citas autorizadas; la app de clientes sigue siendo compatible.

**Dependencias:** fases 1–3 y cuota de fase 2.

## Fase 5 — Operación del salón

**Objetivo:** integrar caja, inventario, recursos y tienda como módulos con límites y permisos por negocio/sede.

**Orden de implementación:**

1. Caja y movimientos: idempotencia, auditoría, anulaciones/reversos y separación de billetera/liquidaciones de plataforma.
2. Inventario e insumos: entradas, salidas, consumos, ajustes y reversos; vincular al servicio solo donde el dato sea verificable.
3. Recursos/alquileres: disponibilidad, responsable y permisos.
4. Tienda/pedidos: pedido, pago, preparación, entrega, devolución y conciliación.
5. Definir entitlements por escala y dependencias de proveedores/hardware.

**Cierre:** operaciones financieras/de inventario resisten reintentos; aislamiento y RBAC se verifican; ventas del salón no se mezclan con fondos de GlowApp; cada módulo puede activarse según el plan.

**Dependencias:** fases 1–3 y agenda de fase 4.

## Fase 6 — Crecimiento, analítica e IA

**Objetivo:** ofrecer herramientas avanzadas como módulos con fuentes, permisos, costos y límites explícitos.

**Orden:** definir fórmulas; conciliar fuentes; construir reportes; vincular fidelización/referidos con costos y reglas del salón; evaluar Academia, diagnóstico e IA; exigir confirmación y auditoría para acciones de impacto.

**Cierre:** fórmulas reproducibles; aislamiento entre negocios; consentimiento y permisos aplicados; costos y cuotas visibles; pilotos identificados como tales.

**Dependencias:** fases 1–5.

## Fase 7 — Paquetes y salida comercial

**Objetivo:** convertir las capacidades verificadas en niveles que el dueño de salón pueda comparar y entender.

**Orden:** asignar módulos, capacidad y límites por escala; reconciliar con catálogo y cobro; redactar onboarding en lenguaje comercial; planear transición de cuentas; ejecutar piloto controlado; medir errores/uso/soporte; ampliar por etapas con rollback listo.

**Cierre:** ninguna promesa excede lo que entitlement y backend habilitan; precios, cuotas, cobro y pantallas coinciden; hay soporte y rollback.

**Dependencias:** fases 1–6.

## Registro obligatorio de cada ejecución

Antes de iniciar, registrar responsable, commit base, alcance de archivos, datos/tenants afectados, impacto comercial, pruebas y rollback. Al terminar, anotar únicamente comandos/escenarios ejecutados, resultados, commit, migraciones, despliegues y observaciones de producción. No declarar producción con evidencia de código local o CI únicamente.

## Orden recomendado de trabajo

1. Cerrar verificaciones operativas de Fase 3 y mapear sus guards heredados.
2. Completar pruebas de cuotas y conciliación de cuentas de Fase 2, coordinando dependencias con Fase 3.
3. Ejecutar Fase 4: agenda y reservas.
4. Ejecutar Fase 5: operación comercial del salón.
5. Ejecutar Fase 6: crecimiento, métricas e IA.
6. Ejecutar Fase 7: empaquetamiento y lanzamiento.
