# Fase 6 — Crecimiento, analítica e inteligencia aplicada

**Estado:** en curso; primer bloque de analítica de negocio desplegado en producción el 23 de noviembre de 2026.
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

- Commit `72e4a46` (`72e4a467f1b7fe5267c5ab7bb854958ebf88ad46`) publicado en `main`; Railway API `b38eeec9-4231-40d9-a3ba-d359a9a291a3` finalizó `SUCCESS` en el entorno `production`.
- Firebase workflow [45291705995](https://github.com/Diegoromerov/glowapp-firebase/actions/runs/45291705995) finalizó `SUCCESS` para el proveedor en el canal `live`; análisis/pruebas de Flutter y build web pasaron. Cliente y APK se omitieron porque no hacían parte de este despliegue.
- Smoke de producción después del despliegue: `GET https://glowapp-api-production.up.railway.app/api/health` devolvió HTTP 200, `env=production` y el commit `72e4a46`; `GET /api/saas/analytics` sin sesión y con audiencia `provider` devolvió HTTP 401.
- Hosting del proveedor `https://glowapp-provider.web.app/` devolvió HTTP 200; el bundle Flutter publicado contiene la ruta `/api/saas/analytics`.
- Railway producción reportó 8/8 servicios en línea, cero incidencias, cero fallas recientes y sin trabajos pendientes.
- Pruebas de servicio focalizadas: 3/3 aprobadas (rango calendario Bogotá, límite de período, agregados/ocupación/privacidad/alcance, rechazo de fechas inválidas).
- `node --check` de `backend/index.js`, la ruta y el servicio: aprobado.
- `flutter analyze --no-pub` de la pantalla nueva: sin hallazgos.
- `git diff --check`: aprobado.
- Generación y compuerta de OpenAPI: cobertura 458/458 (100%), 23 operaciones documentadas explícitamente; artefacto sincronizado con rutas montadas.
- Suite completa de Jest ejecutada: finalizó con fallos en varias áreas que no fueron modificadas por Fase 6 (por ejemplo, dashboard multi-sede, suscripciones, biometría y contratos de pedidos). El test focalizado de analítica sí pasa 3/3. El test OpenAPI inicial detectó duplicados preexistentes de disputas; se incorporaron al allowlist de defectos heredados y `npm run openapi:check` quedó en verde.
- No se hizo una consulta autenticada a PostgreSQL de producción ni un recorrido de la pantalla con una cuenta autorizada. El smoke HTTP no prueba que los KPI funcionen con datos reales ni sustituye la validación de aislamiento entre sedes.

## Pendiente para cerrar Fase 6

1. Revisión final de consultas y permisos con casos de aislamiento entre negocios/sedes; validar PostgreSQL real de producción de manera controlada y de solo lectura.
2. Probar la pantalla con una cuenta de producción autorizada de plan/rol compatible, sin revelar datos personales.
3. Definir y documentar los KPI de fidelización y referidos junto con reglas de costo, atribución, fraude y recompensa; no alterar el sistema de lealtad existente hasta confirmar su correspondencia con membresías SaaS.
4. Decidir qué herramientas existentes de Glow Academy y diagnóstico comercial se empaquetan en cada nivel y qué costos/consentimientos implican.
5. Si se ofrece copiloto de IA, aplicar límites, permisos, consentimiento, registro de auditoría y confirmación explícita para cualquier acción; no permitir cambios automáticos de precios, mensajes masivos ni operaciones financieras.
6. Distinguir con claridad capacidades liberadas, pilotos y complementos aún no disponibles; documentar fórmulas, fuente, período, acceso y privacidad de cada KPI.

Fase 7 no debe comenzar hasta que estos criterios de salida estén resueltos y documentados.
