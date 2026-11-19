# Fase 8 — Endurecimiento operativo de logística

## Objetivo y límites

Reducir riesgo operativo en la logística ya desplegada hasta Fase 7. Esta fase
no habilita transportadoras reales, no cambia tarifas ni checkout, no modifica
datos existentes y no promueve cambios directamente a producción. El candidato
se valida primero en CI y staging; cualquier promoción requiere autorización
separada.

## Estado de partida

- Base de revisión: `origin/main` en `2c8cc4a22f05a3593e6764fdbc9d78aa55254463`.
- Fase 7 está representada por el PR #47.
- El modo real de Envia sigue cerrado por defecto. La cotización productiva
  rechaza generar tarifas simuladas cuando no está en modo mock.
- El cron de métricas corre a las 02:20 UTC y usa advisory lock transaccional
  para evitar ejecución simultánea entre réplicas.
- La recuperación de fulfillment se ejecuta desde el arranque de la API cada
  diez minutos; no se ve una guarda `DISABLE_BACKGROUND_JOBS` alrededor de ese
  intervalo en `backend/index.js`.

## Hallazgos de revisión

1. **Migración 181 omitida en el entrypoint de Railway — corregida en esta
   rama.** `backend/entrypoint.sh` usa `scripts/prepareRlsDatabase.js`, cuyas dos
   listas no incluían `181_productos_peso_kg.sql`. La cadena limpia llegó solo a
   180 y una ejecución real de fulfillment falló con `column p.peso_kg does not
   exist`. Se agregó 181 a las listas de base nueva y base existente.

2. **Riesgo de doble procesamiento de fulfillment — reproducido y corregido en
   esta rama.** Ocho llamadas simultáneas para un pedido de un proveedor
   crearon ocho envíos antes del cambio. El orquestador ahora toma un advisory
   transaction lock por pedido y omite la creación si ese pedido ya tiene
   envíos. Después del cambio, las mismas ocho llamadas crearon un envío; una
   prueba separada conservó dos envíos para dos proveedores distintos y el
   reintento no agregó filas.

3. **Métricas diarias — el arreglo ya existía en `main`.** La migración 180
   agrega `shipment_stats` y `return_stats` por separado. En PostgreSQL 16, un
   envío con dos devoluciones produjo conteo de envíos 1, peso 2 kg, valor
   10.000 COP y costo de etiqueta 2.500 COP (sin multiplicación); ambas
   devoluciones se contaron y reejecutar el refresco dio los mismos agregados.
   La transacción de prueba se revirtió.

4. **`DISABLE_BACKGROUND_JOBS` está limitado a jobs de pago.** CI inicia el
   recuperador de logística, pero el intervalo espera diez minutos; el paso E2E
   de CI espera hasta 45 segundos por la API y después la detiene. El cron de
   métricas espera hasta las 02:20 UTC. No se encontró evidencia de que estos
   jobs se ejecuten durante ese paso de CI. No se cambió el significado de la
   variable.

## Trabajo de la fase

1. Backend CI ejecutado localmente; queda validar en el runner hospedado de GitHub.
2. Validar candidato en staging y observar antes de proponer cualquier
   promoción.
3. Revisar si se necesitan más señales operativas para fallos de fulfillment y
   métricas, sin registrar datos personales ni secretos.

## Criterios de aceptación

- No se producen cotizaciones o etiquetas reales sin habilitación explícita y
  credenciales válidas.
- Reintentar la recuperación no duplica envíos, estados ni notificaciones.
- La migración 181 corre en base nueva y existente, y se puede reaplicar.
- Métricas y fulfillment cumplen los escenarios indicados en PostgreSQL real.
- Backend CI completo y staging pasan; staging permanece estable durante la
  observación acordada.
- Producción no cambia hasta contar con candidato revisado y autorización
  explícita de promoción.

## Decisiones y evidencia pendientes

- Medir posibles duplicados existentes de fulfillment en producción mediante
  consulta de solo lectura antes de decidir si hace falta reconciliación.
- Definir ventana y duración de observación en staging antes de cerrar la fase.

## Evidencia ejecutada (worktree aislado)

- PostgreSQL 16/PostGIS: cadena oficial de base nueva completada y `peso_kg`
  presente como `NUMERIC NULL`; cadena de base existente aplicada dos veces.
- Métricas: dos devoluciones asociadas a un envío no multiplicaron conteo,
  peso, valor ni costo; el segundo refresco produjo los mismos resultados.
- Fulfillment: 8 llamadas concurrentes crearon 1 envío tras el cambio; el caso
  multi-proveedor creó 2 y el reintento los dejó en 2.
- `node --test src/tests/fulfillmentProductWeight.nodetest.js`: 4/4 pasan.
- `npx jest tests/logisticaMetricsCron.test.js --runInBand --forceExit`: 4/4
  pasan.
- Pasos del job Backend CI ejecutados localmente: `npm ci` con npm 10.8.2;
  sintaxis de 603 archivos JS; 95/95 pruebas sin infraestructura; preparación
  RLS en base nueva y reejecución; verificaciones DANE, tenant isolation y RLS
  de métricas; contrato API (370 rutas); suites Jest de contrato 44/44 e
  integración PostgreSQL 10/10; seed y E2E del catálogo HTTP 200 con 1
  proveedor. Los tests, contratos y E2E también se probaron bajo Node 20; la
  pasada completa de sintaxis y el E2E de servidor se hicieron con Node 24
  instalado en el host. No equivale a un resultado de GitHub Actions.
- El paso `verificacion-entorno` del workflow solo corre tras `push` y consulta
  servicios desplegados; se omitió para mantener producción y staging intactos.
- Producción consultada solo por `GET /api/health`: HTTP 200, commit
  `2c8cc4a22f05a3593e6764fdbc9d78aa55254463`, PostgreSQL disponible y sin modo
  memoria. El endpoint no expone si `peso_kg` está presente; no se consultó ni
  modificó la base productiva.
- No se hizo merge, publicación ni despliegue.
