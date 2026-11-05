# Inventario de datos personales — app de clientes (GlowApp)

**Fecha:** 2026-11-05 · **Alcance:** `apps/glow_client`, `packages/glow_core` y la API `backend/` que atiende a esa app · **Ítem de auditoría:** 41
**Marco:** Ley 1581 de 2012 y Decreto 1377 de 2013 (Colombia).

Cómo leer este documento: cada fila dice **qué dato**, **dónde vive exactamente**, **para qué**,
**con qué base legal** y **cuánto se conserva**. Las columnas de retención distinguen entre lo que
el código **hace** y lo que solo **declara**: la diferencia está marcada, no escondida.

Evidencia: **E1** lectura de código y esquema · **E2** ejecución de consultas o scripts · **E3** producción.

> Este inventario se levanta sobre las migraciones (`backend/migrations/`, 127 archivos) y los
> controladores. **No** se consultó la base de producción: no hay credenciales en este entorno y
> la regla del proyecto prohíbe tocarla sin autorización específica. Por tanto el inventario es
> fiel al esquema versionado (E1); si producción tiene tablas fuera de migración, no aparecen aquí.

---

## 1. Identidad y cuenta — `usuarios`

| Dato | Dónde | Finalidad | Base legal | Retención |
|---|---|---|---|---|
| Nombre | `usuarios.nombre` | Saludar, identificar la cuenta y el prestador en la cita | Ejecución del contrato | Mientras la cuenta exista |
| Correo | `usuarios.email` (único) | Login, verificación, recuperación, correos transaccionales | Ejecución del contrato | Mientras la cuenta exista |
| Teléfono | `usuarios.phone` | Contacto operativo de la cita | Ejecución del contrato | Mientras la cuenta exista |
| Contraseña | `usuarios.password_hash` (bcrypt) | Autenticación | Ejecución del contrato | Mientras la cuenta exista |
| Foto de perfil | `usuarios.foto_url` | Personalización del perfil | Consentimiento | Mientras la cuenta exista |
| Proveedor de identidad | `usuarios.auth_provider`, `usuarios.provider_id` | Login con Google/Facebook | Ejecución del contrato | Mientras la cuenta exista |
| Rol y estado | `usuarios.rol`, `is_active`, `onboarding_completo` | Autorización y experiencia | Ejecución del contrato | Mientras la cuenta exista |
| Aceptación de Habeas Data | `usuarios.habeas_data_accepted_at`, `usuarios.habeas_data_ip` | Prueba del consentimiento | Obligación legal | Mientras la cuenta exista |

Esquema: `backend/migrations/000_create_usuarios.sql:5-19`.

## 2. Citas, servicios y valoraciones

| Dato | Dónde | Finalidad | Base legal | Retención |
|---|---|---|---|---|
| Citas (fecha, hora, estado, notas) | `bookings.client_id`, `provider_id`, `service_id`, `starts_at`, `ends_at`, `status`, `notes` | Prestar el servicio y resolver disputas | Ejecución del contrato | Mientras la cuenta exista |
| Servicios contratados | `bookings` + `services` (nombre, precio, duración) | Historial y recibo | Ejecución del contrato | Mientras la cuenta exista |
| Reseñas | `reviews.rating`, `reviews.comment` | Reputación del prestador | Consentimiento (al publicar) | Mientras la cuenta exista |
| Mensajes del chat | `messages.sender_id`, `content`, `message_type`, `read_at` | Comunicación cliente–prestador | Ejecución del contrato | Mientras la cuenta exista |
| Dirección de entrega (tienda) | `pedidos_tienda.direccion_entrega`, `nombre_entrega` | Entregar el pedido | Ejecución del contrato | Mientras la cuenta exista |
| Direcciones guardadas | `user_delivery_addresses.*` (vía, número, letra, formateada) | Agilizar próximos pedidos | Consentimiento | Mientras la cuenta exista |
| Alertas SOS | `sos_alerts.location`, `message`, `status` | Atender una emergencia | Interés vital | Mientras la cuenta exista |

Esquema: `backend/migrations/054_create_core_tables.sql:40-100`, `083_user_delivery_addresses.sql`.

## 3. Dinero

| Dato | Dónde | Finalidad | Base legal | Retención |
|---|---|---|---|---|
| Transacciones | `transactions.amount`, `currency`, `status`, `payment_method`, `external_id` | Cobrar, conciliar y reembolsar | Obligación legal (contable/tributaria) | Mientras la cuenta exista; el histórico contable se conserva por obligación legal |
| Movimientos de monedero | `wallet_transactions.*` (append-only) | Trazabilidad del saldo del prestador | Obligación legal | Igual que arriba |
| Reembolsos | `reembolsos.*` | Devolver dinero al cliente | Ejecución del contrato | Igual que arriba |
| Datos de tarjeta (PAN, CVV) | **No se almacenan** | — | — | — |

Evidencia de que la tarjeta no pasa por el backend: `backend/src/controllers/bookingController.js:1103`
— «aquí solo llega el token o el id de la fuente de pago, nunca el PAN/CVV».

## 4. Ubicación y biometría (datos sensibles)

| Dato | Dónde | Finalidad | Base legal | Retención |
|---|---|---|---|---|
| Coordenadas del cliente | No se persisten: se usan en memoria para ordenar prestadores cercanos | Mostrar quién está cerca | Consentimiento (permiso del sistema) | No aplica: no se guarda |
| Ubicación del prestador | `salones.latitude`, `salones.longitude` | Situar el salón en el mapa | Ejecución del contrato | Mientras el salón exista |
| Escaneos faciales | `user_biometrics.*` | Medir evolución de piel/cabello | **Consentimiento explícito** (`biometric_consents`) | 24 meses desde el último escaneo (`backend/src/config/biometricRetention.js`) |
| Fotos biométricas originales | `user_photos.url_or_path` | Procesar y luego descartar | Consentimiento explícito | **24 horas** (`AutomaticRetentionService.js:146`) |
| Registro de acceso biométrico | `biometric_access_log.*` (incluye IP y `user_agent`) | Auditoría de acceso a datos sensibles | Obligación legal | 365 días, luego se anonimiza el `user_id` |
| Auditoría de consentimiento | `auditoria_consentimiento_biometrico.*` (`ip_registro`) | Probar que hubo consentimiento | Obligación legal | 365 días, luego se anonimiza el `user_id` |
| Consentimientos | `biometric_consents.granted`, `revoked_at` | Gobernar el tratamiento | Obligación legal | Se conserva la constancia |

## 5. Soporte y operación

| Dato | Dónde | Finalidad | Base legal | Retención |
|---|---|---|---|---|
| Tickets y PQRSF | `tickets.*`, `ticket_mensajes.mensaje` | Resolver la solicitud | Ejecución del contrato / obligación legal | Mientras la cuenta exista |
| Códigos OTP | `otp_validaciones.*` | Verificar identidad | Ejecución del contrato | Vida del código (minutos) |
| Analítica de producto | `analytics_events.*` | Saber qué falla en el embudo | Interés legítimo | `user_id` se anonimiza a los 30 días; la fila se borra a los 90 |
| Logs de operación | `logs_debug_operacionales.mensaje` | Diagnosticar errores | Interés legítimo | 30 días y se borran |
| Auditoría administrativa | `admin_audit_logs.*` (incluye `ip`) | Rastrear acciones del panel | Obligación legal | Sin plazo definido — ver huecos |

## 6. Terceros que tratan datos por cuenta de GlowApp

| Tercero | Qué recibe | Evidencia |
|---|---|---|
| Railway | Todo el backend y la base PostgreSQL | `backend/` desplegado como `glowapp-api` |
| Firebase (Google) | Hosting web, autenticación Google, almacenamiento de video, tokens FCM | `apps/glow_client/web/`, `firebase_options.dart`, `push_service.dart` |
| Brevo | Correo transaccional (destinatario, asunto, cuerpo) | `backend/src/services/emailService.js` (API HTTP; Railway bloquea SMTP saliente) |
| Wompi | Importe, referencia y token de pago | `bookingController.js` |
| Cloudflare R2 | Imágenes de producto | `backend/src/routes/adminUploadRoutes.js` |

## 7. Qué NO guardamos

- Números de tarjeta, CVV ni fecha de caducidad: el cobro se tokeniza en Wompi.
- Contraseñas en claro: solo `password_hash`.
- Coordenadas del cliente: se usan para ordenar y se descartan.
- Datos de menores: la app no los pide ni los distingue; el registro es para mayores de edad según los Términos.

## 8. Borrado de cuenta: qué pasa exactamente

`DELETE /api/auth/delete-account` (`backend/src/controllers/authController.js:614`):

1. Borra los datos biométricos y las comparaciones (`consentService.deleteBiometricData`). Si falla, **no** cierra la cuenta.
2. Revoca los consentimientos biométricos (`revoked_at`).
3. **Anonimiza** la fila de `usuarios`: `nombre = 'Usuario Eliminado'`, email reemplazado por
   `deleted_<id>_<ts>@glowapp.deleted`, `password_hash = ''`, `phone = NULL`, `is_active = false`, `fcm_token = NULL`.

**Consecuencia que el usuario debe poder leer en la política:** la cuenta queda **anonimizada, no
suprimida**. Las citas, mensajes, reseñas y transacciones siguen existiendo ligadas a un `id` que ya
no identifica a nadie, porque el histórico es necesario para la contabilidad y para resolver
disputas. Ningún dato de contacto sobrevive.

## 9. Huecos conocidos (declarados, no resueltos)

| Hueco | Por qué importa | Evidencia |
|---|---|---|
| **Las políticas de retención no se ejecutan** | `AutomaticRetentionService` define los plazos, pero `src/crons/automaticRetentionCron.js` **no está importado en ningún entrypoint**: nadie lo programa. Los plazos de la sección 5 y 4 son hoy intención, no hecho | `grep -rn "automaticRetentionCron" backend/` → solo el propio archivo |
| Logs de Railway con datos personales | Los `console.log` del backend pueden incluir emails o ids; no se auditó su contenido en producción (ítem 44 sigue PARCIAL) | Sin medición |
| Analítica: qué se envía | `AnalyticsService` instrumenta 44 eventos; no se revisó campo por campo si alguno lleva datos personales | Sin barrido |
| Retención contable | No hay plazo escrito para `transactions` / `wallet_transactions`; se asume el que exija la norma contable, sin fecha | `AutomaticRetentionService` no las cubre |

## 10. Derechos del titular y canales

- **Conocer, actualizar, rectificar y suprimir**: `privacidad@glowapp.co` (consultas en 10 días
  hábiles, reclamos en 15, como ya publica `privacy.html`).
- **Revocar el consentimiento biométrico**: desde Ajustes, en la app.
- **Borrar la cuenta**: en la app (Perfil → Eliminar mi cuenta) o en
  `https://glowapp-client.web.app/account-deletion.html`.
- **Reclamar**: Superintendencia de Industria y Comercio.

## 11. Cómo se mantiene este documento

Cualquier migración que añada una columna con datos personales, o cualquier servicio nuevo que
envíe datos a un tercero, debe **actualizar esta tabla en el mismo commit**. Si no se actualiza, el
inventario miente y la política de privacidad también.
