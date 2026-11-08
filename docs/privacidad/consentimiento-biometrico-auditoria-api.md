# Consentimiento biométrico y API de auditoría

## Alcance

Esta implementación endurece la autorización para análisis facial y manos, registra evidencia de cada transición y expone lecturas para el futuro dashboard. No crea el dashboard ni sustituye la política integral de tratamiento, los contratos con encargados o una evaluación legal. El flujo de ticket ARCO está documentado en `docs/privacidad/flujo-arco-pqrsf.md`.

## Base normativa aplicada al flujo

- Ley 1581 de 2012, arts. 5 y 6: los datos biométricos son sensibles y el tratamiento requiere una excepción legal, incluida autorización explícita.
- Arts. 8, 9 y 12: derechos de acceso/rectificación/supresión/revocatoria; prueba consultable de autorización previa e informada; información del responsable, finalidad, derechos y carácter facultativo de los datos sensibles.
- Art. 26: transferencias a países sin nivel adecuado requieren una excepción legal, incluida autorización expresa e inequívoca. El aviso identifica proveedores, países y datos compartidos; la validez de los contratos y garantías de transferencia debe confirmarse por el responsable.
- Decreto 1074 de 2015, arts. 2.2.2.25.2.3 y 2.2.2.25.4.1: advertir que autorizar datos sensibles es facultativo, precisar datos/finalidad y obtener autorización expresa por un mecanismo consultable.

## Cambios funcionales

1. Aviso vigente `2.3` generado por servidor, con responsable y correo, datos sensibles, finalidad, carácter facultativo, proveedores/destinos/datos compartidos, plazo biométrico, derechos y canal.
2. El cliente y proveedor presentan el aviso antes de otorgar o renovar permiso. La persona debe marcar una casilla expresa que cubre el tratamiento y, si aplica, la transferencia internacional.
3. El servidor rechaza concesiones sin versión vigente, hash SHA-256 exacto y `explicit_authorization: true`.
4. El análisis exige consentimiento `facial_analysis` no revocado y con versión vigente. Un consentimiento anterior se muestra como renovación pendiente y no habilita nuevos análisis.
5. Revocar bloquea nuevos análisis inmediatamente. La supresión registra `SUPPRESSION_REQUESTED`, `SUPPRESSION_COMPLETED` o `SUPPRESSION_FAILED`, correlacionados con `request_id`. Si falla el borrado, la UI conserva estado revocado y permite reintentar.
6. La tabla `biometric_consent_audit` recibe por trigger una copia del estado antes/después y del snapshot aceptado. Un trigger rechaza `UPDATE`/`DELETE` sobre la bitácora desde el rol normal de la aplicación. No es inmutable frente a un propietario/superusuario de la base; proteger credenciales y exportar periódicamente evidencia fuera de esa base es responsabilidad operativa.
7. Los eventos de auditoría no guardan fotos ni métricas. La API del dashboard omite IP, correo y user-agent; entrega una referencia HMAC seudonimizada. La bitácora de base mantiene `user_id` para probar trazabilidad y no tiene FK que la borre en cascada.

## API para el futuro dashboard

Todas las rutas de auditoría requieren `Authorization: Bearer <JWT>` y rol `admin` (`req.user.role === 'admin'`). La clave para la seudonimización debe permanecer estable; configurar `AUDIT_PSEUDONYM_SECRET` en staging/producción (si no existe, hoy se deriva de `JWT_SECRET`, por lo que rotar ese secreto cambia las referencias mostradas).

### Obtener aviso que se presenta al titular

`GET /api/consent/terms` (público)

Respuesta: `data` contiene el aviso, su `version` y `document_sha256`. La aplicación debe presentar el contenido recibido; no debe construir una autorización con texto local distinto.

### Resumen de auditoría

`GET /api/consent/audit/summary?from=2026-01-01T00:00:00Z&to=2026-12-31T23:59:59Z`

Devuelve totales por evento, autorizaciones actuales y obsoletas, versión vigente y metadatos de la tabla fuente.

### Eventos y expedientes de autorización

`GET /api/consent/audit/events?from=<ISO>&to=<ISO>&event_type=GRANTED&consent_type=facial_analysis&user_id=123&limit=50&offset=0`

Filtros opcionales: `from`, `to`, `event_type`, `consent_type`, `user_id` (solo filtra; el ID nunca se devuelve), `limit` (máx. 100) y `offset`. La respuesta incluye `subject_ref`, versión, finalidad, snapshot del texto, hash, fechas, estados previo/posterior y paginación.

El dashboard debe guardar juntos el JSON del resumen, la página de eventos y el instante de consulta si necesita un expediente descargable. Toda lectura administrativa de esta API queda sujeta a los logs generales del servidor; el acceso a eventos biométricos en uso sigue en `GET /api/consent/access-logs`.

### Consulta de datos propios

- `GET /api/consent/history`: historial propio de autorizaciones.
- `GET /api/consent/export`: expediente JSON propio, ahora incluye evidencia de autorización.
- `GET /api/biometric/history`: serie de mediciones propia.

### Revocación y supresión

- `DELETE /api/consent/biometric/facial_analysis`: revoca.
- `DELETE /api/consent/biometric/facial_analysis/data` y `DELETE /api/consent/data`: solicitan supresión y responden `request_id` si la confirman. Ante fallo, el identificador queda registrado como solicitud fallida para su revisión.

## Retención, despliegue y decisiones pendientes

- Aplicar `backend/migrations/131_biometric_consent_audit_evidence.sql` a staging antes de desplegar el backend. El runner de migraciones numeradas la ejecuta al arrancar.
- Métricas biométricas: retención configurada a 24 meses desde el último escaneo; las sesiones antiguas se purgan mediante el job ya existente.
- Evidencia de autorización/supresión: la Ley no fija en estas disposiciones un plazo universal para todos los soportes. La tabla no autoelimina evidencia. GlowApp debe aprobar y documentar un plazo/criterio de conservación con su asesoría jurídica y reflejarlo en la política; al vencerlo, deberá aplicar borrado/anonimización sin perder evidencia que todavía deba conservarse.
- La política pública dice `privacidad@glowapp.co`; debe verificarse que el buzón esté operativo y atendido por el responsable.
- Las ubicaciones configuradas de proveedores pueden implicar transferencias internacionales. Antes de declarar cumplimiento, el responsable debe validar las ubicaciones reales del procesamiento, cláusulas/garantías con cada encargado y que la autorización expresa cubra los destinos efectivos.
- El ticket integral de consultas/reclamos y sus términos legales de respuesta siguen en la tarea 5; esta API no debe confundirse con ese flujo.

## Referencias oficiales

- [Ley 1581 de 2012 — Gestor Normativo de Función Pública](https://www1.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981)
- [Ley 1581 — Normograma de Cancillería, artículo 26](https://cancilleria.gov.co/normograma/compilacion/docs/ley_1581_2012.htm)
- [Decreto 1074 de 2015 — Normograma de Cancillería](https://www.cancilleria.gov.co/normograma/compilacion/docs/decreto_1074_2015.htm)
