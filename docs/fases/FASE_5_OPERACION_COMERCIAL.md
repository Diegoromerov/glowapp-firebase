# Fase 5 — Operación comercial del salón

**Estado:** implementación y validación en curso.

**Entorno elegido:** producción directa, por instrucción expresa del usuario; no se usa staging.

**Fecha de inicio:** 23 de noviembre de 2026.

## Objetivo

Consolidar caja, inventario, consumo de insumos y alquiler de recursos por sede, con permisos y trazabilidad. La caja operativa del salón sigue separada de la billetera y de las liquidaciones de GlowApp. La tienda de GlowApp conserva su inventario, sus precios publicados y su checkout actual.

## Cambios de esta fase

- Migración aditiva `194_fase5_operacion_comercial.sql`: claves de idempotencia para movimientos de caja e inventario, vínculo entre movimientos de inventario y reservas/servicios, recetas opcionales por servicio y libro de consumo por reserva con cantidades solicitadas, consumidas y faltantes. No reescribe saldos ni movimientos previos.
- El inventario del salón registra entradas, salidas y ajustes en un historial; bloquea el artículo durante el cálculo para evitar saldos negativos bajo concurrencia. Una clave de idempotencia repetida con los mismos datos devuelve la operación original; con datos distintos produce conflicto.
- Al confirmar por OTP una reserva que pertenece a una sede, descuenta la receta configurada dentro de la misma transacción de finalización y registra el movimiento. Si falta inventario, consume lo disponible, registra el faltante y no bloquea un servicio ya prestado.
- La caja del salón permite reintentar un registro sin duplicarlo, conservando el mismo movimiento y constancia.
- Se habilita al prestador consultar y configurar recetas de insumos por servicio, administrar recursos alquilables y liberar un alquiler. Se mantienen los roles ya existentes para lectura y escritura.
- No se incluye una tienda independiente por salón: el catálogo/checkout de GlowStore existente es una oferta de plataforma, no un inventario comercial por sede. La conexión comercial de ese producto con las capacidades SaaS queda para definición de una fase posterior.

## Escala comercial y límites actuales

La aplicación ya ofrece caja, inventario, recursos y alquileres sujetos a roles. El catálogo de capacidades de planes no tiene aún cuotas/entitlements específicos para caja, recetas, alertas o recursos; esta entrega no publica nuevos límites ni cambia precios. La matriz de empaquetado por escala deberá acordarse y hacerse cumplir desde backend antes de ofrecer estas capacidades como diferencias pagadas entre planes.

Las alertas de bajo stock se calculan al comparar `stock_actual` con `stock_minimo`. El faltante por receta queda en un registro acumulativo visible para conciliación; no se interpreta automáticamente como pedido de compra ni se restaura por cancelar una reserva completada.

## Migración, permisos y reversión

- La migración solo agrega columnas, índices y tablas. Se activa y fuerza RLS en las nuevas tablas, con política de tenant, y no modifica datos históricos existentes.
- No hay reversión destructiva automática: las nuevas tablas/columnas deben conservarse para auditoría. Para desactivar el consumo automático se puede dejar la receta vacía; la migración inversa deberá ser una operación manual con respaldo y revisión de dependencias.
- El cierre del alquiler cambia su estado a `FINALIZADO` y libera el recurso. No emite un movimiento de caja ni calcula cobros parciales; el registro de ingresos de alquiler continúa siendo una operación explícita de caja.
- El comprobante de caja es una constancia interna del salón, no una factura electrónica de DIAN.

## Verificación y despliegue

Pendiente hasta la publicación: resultado de pruebas automatizadas/análisis, migración 194 aplicada en PostgreSQL de producción, estado de Railway, smoke checks de salud y de esquema, y publicación de la app prestador en Firebase Hosting. Se registrarán aquí los SHA, ejecución de CI, número de migración observado y URLs/estados una vez comprobados.

## Trabajo posterior

- Diseñar la matriz de capacidades y cuotas por plan y aplicarla en backend.
- Definir ajustes/reversos de movimientos con trazabilidad explícita.
- Determinar si se requiere una tienda por sede separada del marketplace.
- Añadir conciliación de faltantes de consumo y reportes por periodo/sede.
