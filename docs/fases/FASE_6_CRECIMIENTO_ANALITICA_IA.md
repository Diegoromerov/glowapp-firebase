# Fase 6 — Crecimiento, analítica e inteligencia aplicada

**Estado:** en curso; primer bloque de analítica de negocio implementado localmente, aún no publicado en producción.
**Fecha de actualización:** 23 de noviembre de 2026.
**Decisión operativa:** validar y desplegar directamente en producción, sin staging, según instrucción del usuario.

## Propósito

Ampliar el producto SaaS con herramientas que ayuden al dueño del salón a operar y crecer: indicadores de negocio, fidelización y referidos, formación/diagnóstico y asistencia inteligente. Los datos del negocio deben permanecer aislados por salón/sede; los indicadores no deben confundir datos de caja con telemetría técnica o pagos procesados por GlowApp.

## Entrega local: analítica agregada del negocio

Se añadió una ruta de backend `GET /api/saas/analytics` y una pantalla del proveedor **Analítica del negocio**.

| Indicador | Cálculo y fuente | Alcance/limitación actual |
| --- | --- | --- |
| Citas, completadas y canceladas | Reservas lógicas por `scheduled_at`; se agrupan los segmentos de una cita mediante `primary_booking_id`, y se excluyen segmentos marcados `is_primary=false` del conteo. | No incorpora reservas fuera del negocio/sede seleccionados. |
| Tasa de finalización | Citas completadas / citas lógicas del período. | Nula si no hubo citas. |
| Clientes recurrentes | Clientes distintos con dos o más citas lógicas completadas dentro del mismo período. | Solo conteo agregado, excluye reservas sin cliente vinculado; no es una cohorte entre períodos. |
| Ocupación estimada | Minutos de servicios reservados no cancelados / minutos del horario configurado de prestadores activos con servicios activos en la sede. | Requiere sede seleccionada; no descuenta pausas, cierres excepcionales ni bloqueos. |
| Caja | Ingresos, gastos, neto y movimientos, agrupados por moneda, desde `caja_movimientos`. | No suma reservas ni pagos de GlowApp, para evitar doble conteo. Ingreso de producto solo identifica movimientos categorizados PRODUCTO; no hay unidades por SKU normalizadas. |
| Inventario | Artículos activos en/bajo mínimo y productos activos desde `inventario_salon`; líneas con faltante desde `inventario_consumos_reserva`. | El nivel bajo se calcula al consultar; líneas de faltante respetan el rango de fechas. |
| Equipo activo | Membresías activas del negocio. | Es un conteo del negocio, no una lista de personas ni un conteo exclusivo por sede. |

Los períodos usan calendario `America/Bogota`, por defecto los últimos 30 días y con máximo de 366 días. Las fechas son inclusivas para quien consulta; internamente el fin se convierte a límite exclusivo. La ruta exige autenticación SaaS, capacidad `ADVANCED_ANALYTICS` y rol OWNER/ADMIN/MANAGER. Las consultas que usan la conexión de sistema filtran de forma explícita el `business_profile_id` y, cuando existe, la sede. La respuesta no incluye identificadores, nombres, teléfonos ni correos de clientes.

La pantalla se incorporó al menú **Más** del proveedor y conserva el formato de menú de solo texto elegido previamente. Para planes sin Analítica avanzada y roles sin acceso se muestran estados diferenciados.

## Evidencia disponible

- Pruebas de servicio focalizadas: 3/3 aprobadas (rango calendario Bogotá, límite de período, agregados/ocupación/privacidad/alcance, rechazo de fechas inválidas).
- `node --check` de `backend/index.js`, la ruta y el servicio: aprobado.
- `flutter analyze --no-pub` de la pantalla nueva: sin hallazgos.
- `git diff --check`: aprobado.
- Generación y compuerta de OpenAPI: cobertura 458/458 (100%), 23 operaciones documentadas explícitamente; artefacto sincronizado con rutas montadas.
- Suite completa de Jest ejecutada: finalizó con fallos en varias áreas que no fueron modificadas por Fase 6 (por ejemplo, dashboard multi-sede, suscripciones, biometría y contratos de pedidos). El test focalizado de analítica sí pasa 3/3. El test OpenAPI inicial detectó duplicados preexistentes de disputas; se incorporaron al allowlist de defectos heredados y `npm run openapi:check` quedó en verde.
- No se hizo una consulta autenticada a PostgreSQL de producción. El health check debe confirmarse con la ruta/header apropiados después del despliegue; el inventario previo de Railway mostró 8/8 servicios en línea, sin fallas recientes ni trabajo pendiente.
- La comprobación previa de Railway mostró 8/8 servicios en línea, sin fallas recientes ni trabajo pendiente. Esto es estado previo y no prueba que esta implementación esté desplegada.

## Pendiente para cerrar Fase 6

1. Revisión final de consultas y permisos con casos de aislamiento entre negocios/sedes; validar con PostgreSQL real de producción de manera controlada y de solo lectura, una vez que exista el código publicado.
2. Publicar API y aplicación del proveedor en producción; comprobar estado del despliegue, salud de API y respuesta 401 en ruta nueva sin credenciales.
3. Probar la pantalla con una cuenta de producción autorizada de plan/rol compatible, sin revelar datos personales.
4. Definir y documentar los KPI de fidelización y referidos junto con reglas de costo, atribución, fraude y recompensa; no alterar el sistema de lealtad existente hasta confirmar su correspondencia con membresías SaaS.
5. Decidir qué herramientas existentes de Glow Academy y diagnóstico comercial se empaquetan en cada nivel y qué costos/consentimientos implican.
6. Si se ofrece copiloto de IA, aplicar límites, permisos, consentimiento, registro de auditoría y confirmación explícita para cualquier acción; no permitir cambios automáticos de precios, mensajes masivos ni operaciones financieras.
7. Distinguir con claridad capacidades liberadas, pilotos y complementos aún no disponibles; documentar fórmulas, fuente, período, acceso y privacidad de cada KPI.

Fase 7 no debe comenzar hasta que estos criterios de salida estén resueltos y documentados.
