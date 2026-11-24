# Fase 6 — Crecimiento, analítica e inteligencia aplicada

**Estado:** en curso; analítica de negocio desplegada en producción. El esquema de fidelización existe en producción, sin datos y sin rutas activas; la API y las interfaces están pendientes de desplegar.
**Fecha de actualización:** 23 de noviembre de 2026.
**Decisión operativa:** validar y desplegar directamente en producción, sin staging, según instrucción del usuario.
**Decisión comercial de fidelización (23 de noviembre de 2026):** cada salón define sus propias reglas de puntos y recompensas. El programa del salón será independiente de los puntos globales de GlowApp.

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

La pantalla permite consultar los últimos 7, 30 o 90 días, o elegir un período manual de hasta 366 días. Los límites de fecha y el calendario `America/Bogota` se validan también en el servidor; la selección en la interfaz no sustituye esa validación.

## Evaluación de herramientas existentes para comercializar como SaaS

| Herramienta existente | Estado comercial para SaaS | Motivo y condición para ofrecerla |
| --- | --- | --- |
| Analítica del negocio | **Disponible** en Profesional y Empresarial para OWNER, ADMIN y MANAGER. | Es la primera herramienta avanzada liberada. Muestra agregados con período, fórmulas y limitaciones documentados. |
| Glow Academy | **Producto existente; no se vende como complemento SaaS** en esta fase. | La academia maneja cursos y consentimiento educativo propios. La autorización para prácticas con imágenes es sensible y no debe heredarse a otros usos ni convertirse en requisito para analítica. Separar catálogo, costos y permisos antes de empaquetarla. |
| Diagnóstico del negocio | **Piloto/función existente; no anunciar como capacidad multi-sede SaaS.** | Parte del flujo aún identifica el expediente por proveedor y el `tenant_id` legado. Requiere migrar el dominio a `business_profile_id`, revisar propiedad de expedientes/tareas y auditar operaciones antes de cobrarlo por plan. |
| Copiloto AURA del proveedor | **Asistente existente; no integrado al producto SaaS.** | La pantalla usa el chat global del proveedor y no prueba alcance por membresía, negocio y sede. No se debe presentar como analista conectado a datos del salón ni automatizar acciones comerciales hasta completar esos controles. |
| Referidos y puntos de GlowApp | **Programa global de GlowApp; no equivale a fidelización de un salón.** | El modelo usa `usuarios`, conversiones globales y puntos de la plataforma. No debe acreditarse en nombre de un salón ni confundirse con su costo, saldo o recompensa. |
| Fidelización y referidos propios del salón | **Esquema listo en producción; API e interfaces pendientes de despliegue. Referidos fuera de alcance.** | Los objetos del esquema existen vacíos y con RLS forzado; la migración todavía debe registrarse durante el arranque de la API. Cada salón configura sus reglas; usa ledger independiente y no modifica `points_lots` ni el programa global. Los referidos del salón no están implementados. |

### Diseño aprobado para fidelización propia del salón

La decisión comercial es que **cada salón define sus reglas**; GlowApp proporciona los controles, el registro y las herramientas para aplicarlas. Una configuración inicial deberá permitir al negocio definir, como mínimo:

- cómo se ganan puntos (por compra, servicio completado u otra regla explícita),
- la conversión o fórmula de acumulación, y si existen topes o vigencia,
- qué recompensas ofrece, cuántos puntos cuesta cada una y sus límites,
- si la regla aplica a todo el negocio o solo a sedes determinadas.

El cliente debe poder consultar puntos del salón, movimientos, vencimientos y condiciones antes de redimir. Los canjes deben validarse en el servidor y ser atómicos/idempotentes, con reverso trazable ante devolución o cancelación elegible. Los cambios de reglas deben tener auditoría y no alterar movimientos históricos. No se debe inferir una compra desde una reserva creada ni otorgar premios por una operación que no alcanzó el estado definido en las reglas del salón.

**Separación de dominios:** los puntos globales de GlowApp (`points_lots`, ligados a `user_id` y reglas globales) permanecen intactos. El nuevo programa será propiedad del negocio SaaS (`business_profile_id`) y podrá acotarse por `salon_id`; su libro tendrá reglas, saldo y movimientos propios. Compartir el inicio de sesión del usuario no implica compartir saldos ni consentimientos entre los dos programas.

**Base arquitectónica disponible:** `business_profiles`/`memberships` ofrecen identidad y RBAC del negocio; `salones` conecta sedes al perfil; operaciones de Fase 5 muestran el patrón de idempotencia, aislamiento por `tenant_id`/`salon_id` y RLS. Antes de migrar fidelización, debe confirmarse la relación canónica entre `business_profile_id`, `tenant_id` (tipos y valores en producción) y `salon_id`, y elegirse una identidad de cliente del salón que no dependa exclusivamente del rol o membresía de personal. El acceso del cliente a su saldo debe comprobar también la titularidad del ledger, no solo conocer el ID del negocio.

## Implementación de fidelización propia del salón

La migración `195_salon_loyalty_foundation.sql` crea programa, auditoría de reglas y recompensas, cuentas, movimientos y canjes con claves de alcance negocio/sede, llaves foráneas compuestas, índices y RLS forzado. PostgreSQL rechaza que un canje de una sede use una recompensa perteneciente a otra. La regla inicial por sede permite asignar puntos por servicio completado y por cada $1.000 COP pagados. Cada salón puede activar/desactivar sus reglas y definir recompensas y costo en puntos. El libro de movimientos no usa ni altera los puntos globales.

La API administrativa permite consultar y auditar reglas, gestionar recompensas, listar reservas aptas y acreditar manualmente. Solo se consideran reservas lógicas principales, `COMPLETADA`, con pago `paid`, cliente asociado y pertenencia al negocio/sede activos. La clave estable de la reserva y la restricción única impiden acreditar dos veces. El canje valida saldo y límites dentro de una transacción; si el salón cancela un canje pendiente, devuelve los puntos con un movimiento idempotente. La pantalla del salón incluye la administración de reglas, premios, el historial auditable, acreditación y canjes.

El cliente puede consultar desde sus reservas el saldo, movimientos y recompensas de esa sede, y pedir un canje. El comercio debe entregar el premio desde su pantalla. La identidad se resuelve mediante `req.user.id`; el cliente no puede consultar saldos de terceros. El catálogo disponible no incluye datos personales.

**Límites antes de comercializar o llamar a esto una automatización completa:** la acreditación todavía requiere que personal del salón la ejecute; no se engancha automáticamente al webhook de pago/terminación. No hay caducidad configurable, campañas/referidos propios, controles antifraude para devolución tardía, topes presupuestales ni segmentación por grupos de sedes. No se asigna todavía a una capacidad o precio de plan. Deben acordarse consentimiento y reglas de privacidad para comunicaciones comerciales. La migración y el despliegue de esta entrega aún deben verificarse en producción.

**Fuera de alcance:** analítica de cohortes/retención; campañas/referidos del salón; migración o conversión desde puntos globales; cobro comercial de fidelización. Glow Academy, diagnóstico y AURA siguen sujetos a las condiciones de integración indicadas arriba.

Por tanto, el catálogo SaaS conserva **Analítica avanzada** como único complemento de crecimiento habilitado en esta fase. Academia, diagnóstico, AURA y fidelización propia permanecen fuera de la oferta comercial SaaS hasta que su alcance y controles estén resueltos.

## Evidencia disponible

- Commit `72e4a46` (`72e4a467f1b7fe5267c5ab7bb854958ebf88ad46`) publicado en `main`; Railway API `b38eeec9-4231-40d9-a3ba-d359a9a291a3` finalizó `SUCCESS` en el entorno `production`.
- Firebase workflow [45291705995](https://github.com/Diegoromerov/glowapp-firebase/actions/runs/45291705995) finalizó `SUCCESS` para el proveedor en el canal `live`; análisis/pruebas de Flutter y build web pasaron. Cliente y APK se omitieron porque no hacían parte de este despliegue.
- Smoke de producción después del despliegue: `GET https://glowapp-api-production.up.railway.app/api/health` devolvió HTTP 200, `env=production` y el commit `72e4a46`; `GET /api/saas/analytics` sin sesión y con audiencia `provider` devolvió HTTP 401.
- Hosting del proveedor `https://glowapp-provider.web.app/` devolvió HTTP 200; el bundle Flutter publicado contiene la ruta `/api/saas/analytics`.
- Railway producción reportó 8/8 servicios en línea, cero incidencias, cero fallas recientes y sin trabajos pendientes.
- Pruebas de servicio focalizadas: 3/3 aprobadas (rango calendario Bogotá, límite de período, agregados/ocupación/privacidad/alcance, rechazo de fechas inválidas).
- `node --check` de `backend/index.js`, la ruta y el servicio: aprobado.
- `flutter analyze --no-pub` de la pantalla nueva: sin hallazgos.
- La pantalla ofrece períodos de 7/30/90 días y rango manual (máximo 366); `flutter analyze --no-pub` del cambio y `flutter build web --release` finalizaron correctamente.
- Intento inicial de la prueba focalizada sin `JWT_SECRET` no inició las pruebas; reejecutada con una clave efímera de pruebas: 3/3 aprobadas.
- Actualización de filtros publicada desde `main` en el flujo Firebase live [45294582988](https://github.com/Diegoromerov/glowapp-firebase/actions/runs/45294582988): análisis/pruebas, build del proveedor y Deploy to Firebase Hosting finalizaron en `SUCCESS`; los jobs de la app cliente se omitieron.
- Verificación posterior a publicación: `https://glowapp-provider.web.app/` HTTP 200; `main.dart.js` HTTP 200 y contiene las opciones del selector, el límite de período y la URL de API de producción.
- API de producción respondió HTTP 200 y reportó commit `6da8d1e5b2d6bc94ec8810164c1d0131028c4cc2`; `/api/saas/analytics` sin sesión continúa respondiendo HTTP 401.
- `git diff --check`: aprobado.
- Generación y compuerta de OpenAPI: cobertura 458/458 (100%), 23 operaciones documentadas explícitamente; artefacto sincronizado con rutas montadas.
- Suite completa de Jest ejecutada: finalizó con fallos en varias áreas que no fueron modificadas por Fase 6 (por ejemplo, dashboard multi-sede, suscripciones, biometría y contratos de pedidos). El test focalizado de analítica sí pasa 3/3. El test OpenAPI inicial detectó duplicados preexistentes de disputas; se incorporaron al allowlist de defectos heredados y `npm run openapi:check` quedó en verde.
- No se hizo una consulta autenticada a PostgreSQL de producción ni un recorrido de la pantalla con una cuenta autorizada. El smoke HTTP no prueba que los KPI funcionen con datos reales ni sustituye la validación de aislamiento entre sedes.
- Fidelización, pendiente de publicar: 17 pruebas backend focalizadas, 7/7 validaciones del guard de migraciones, OpenAPI 472/472, análisis de las dos pantallas nuevas y builds web de proveedor/cliente correctos.
- Una ejecución inicial de la migración 195 en producción alcanzó `COMMIT` por un error de escape en el comando de prueba; creó los siete objetos de tabla vacíos, nueve políticas RLS y cuatro triggers, pero no registró el archivo en `schema_migrations`. No hay rutas de API publicadas todavía. La migración se hizo idempotente y una segunda validación íntegra sí sustituyó el `COMMIT` por `ROLLBACK` usando el índice explícito del comando; finalizó correctamente.
- Consulta `BEGIN READ ONLY` posterior: las siete tablas no tienen filas y las siete tienen `ENABLE RLS` y `FORCE RLS`; también se verificaron llaves compuestas de sede/recompensa y triggers de auditoría. El despliegue de la API deberá volver a ejecutar 195 de forma idempotente y registrar su nombre antes de exponer las rutas.

## Pendiente para cerrar Fase 6

1. Revisión final de consultas y permisos con casos de aislamiento entre negocios/sedes; validar PostgreSQL real de producción de manera controlada y de solo lectura.
2. Probar la pantalla con una cuenta de producción autorizada de plan/rol compatible, sin revelar datos personales.
3. Publicar y validar la migración/API/interfaces de fidelización directamente en producción; probar acceso autorizado del salón y la experiencia del cliente sin leer ni revelar información personal ajena.
4. Automatizar la acreditación ante el evento de negocio confiable (pago y servicio completado), y diseñar reversos ante devoluciones o disputas posteriores antes de ofrecerlo comercialmente.
5. Añadir vigencia, topes, controles de fraude y consentimiento de campañas; decidir el nivel comercial y sus límites antes de cobrar la fidelización.
6. Si se empaqueta Glow Academy, migrar su autorización y progreso al negocio SaaS y definir catálogo, precio y consentimiento separado para cualquier tratamiento sensible.
7. Migrar diagnóstico comercial a identidad canónica del negocio/sede y auditar propiedad de tareas, evidencias y documentos antes de cobrarlo por nivel.
8. Integrar el copiloto a membresía/sede y consentimientos antes de ofrecerlo como herramienta SaaS conectada a datos comerciales. Cualquier acción de impacto deberá pedir confirmación y dejar auditoría.
9. Mantener explícita la separación entre capacidades disponibles, pilotos y funciones fuera de la oferta; documentar costos externos antes de asignarles precio o límites.

Fase 7 no debe comenzar hasta que estos criterios de salida estén resueltos y documentados.
