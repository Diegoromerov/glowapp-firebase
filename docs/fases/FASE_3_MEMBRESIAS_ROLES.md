# Fase 3 — Membresías, roles y permisos

**Fecha:** 23 de noviembre de 2026
**Estado:** desplegada en producción el 23 de noviembre de 2026.

## 1. Objetivo y alcance ejecutado

Concentrar la gestión de equipo en `memberships`, hacer que las rutas SaaS y heredadas utilicen las mismas reglas, proteger invitaciones y cambios de rol, y dejar una bitácora auditable. Se conserva compatibilidad para aceptar invitaciones históricas de salón.

El contrato actual invita a cuentas GlowApp ya registradas. La invitación vence a los siete días. El registro de una cuenta nueva desde el enlace de invitación queda fuera de esta fase.

## 2. Qué se hizo

- Se creó `backend/src/services/saasMembershipService.js` como servicio común para listar, invitar, aceptar, cambiar roles, suspender/reactivar, retirar y reenviar invitaciones.
- `/api/saas/team` dejó de contener sus propias escrituras SQL. `/api/v1/memberships` quedó como adaptador hacia el mismo servicio.
- Las invitaciones nuevas de `/api/salon/invite` se guardan en la membresía SaaS canónica, mantienen el `sub_rol` de salón y usan el servicio de correo existente. La pantalla de aceptación reutiliza la ruta heredada, que intenta el token canónico y mantiene la compatibilidad con invitaciones históricas.
- Los tokens nuevos tienen 32 caracteres aleatorios; en la base solo se guarda su SHA-256. Se vinculan al correo invitado, expiran en siete días, se invalidan al aceptar/cancelar y no se devuelven en las respuestas API. El reenvío genera un token nuevo.
- No se envían invitaciones a correos sin cuenta registrada; el API responde `404` indicándolo. Si el servicio de correo no está configurado o no confirma el envío, se conserva la invitación y se devuelve `202` para permitir su reenvío.
- Las invitaciones pendientes y activas se cuentan como asientos. Altas, reactivaciones y aceptaciones se serializan con bloqueo del perfil de negocio; invitaciones vencidas se cierran y dejan de ocupar asiento. El panel de consumo usa la misma regla de vencimiento.
- Se centralizó la matriz RBAC: OWNER puede cambiar roles; ADMIN gestiona invitaciones y estados, pero no cambia roles ni propiedad. Las etiquetas operativas heredadas se derivan al rol SaaS.
- La pantalla de equipo separa invitaciones pendientes/vencidas y permite suspender o reactivar miembros.
- `saasContext` y `membershipMiddleware` ahora fallan cerrados si no pueden verificar el rol. `requirePermission` ya no toma `provider` ni un rol obsoleto del JWT como sustituto de una membresía de negocio.
- La migración aditiva `190_saas_membership_governance.sql` agrega campos de vencimiento/hash y baja, amplía los estados, crea índices y la tabla append-only `membership_audit_logs`. Se auditan invitación, aceptación, expiración, cambio de rol, suspensión, reactivación y retiro. `GET /api/saas/team/audit` muestra hasta 100 eventos del tenant actual a OWNER/ADMIN.

## 3. Cómo funciona ahora

El tenant y el rol activo se obtienen de `memberships`. Enviar o renovar una invitación bloquea el perfil, comprueba el usuario, el plan y los asientos, escribe la membresía y la auditoría en una transacción y después envía el enlace. La aceptación verifica el hash, la vigencia y que el correo de la sesión coincida antes de activar la membresía. Una invitación vencida no puede activarse desde la ruta de estados: debe renovarse y volver a reservar asiento. Las rutas anteriores de salón pueden aceptar invitaciones ya emitidas durante la transición.

En interfaz, los estados `PENDING`, `EXPIRED`, `ACTIVE`, `SUSPENDED` y `REMOVED` se presentan por separado. Suspender libera un asiento; reactivar vuelve a verificar el límite vigente.

## 4. Decisiones tomadas

- Se conservó `memberships` como entidad canónica existente; no se creó un tercer modelo de equipo.
- Los roles de propietario, administrador, gerente, personal y consulta se mantienen. La gestión de roles queda reservada al OWNER para coincidir con el contrato existente de `/api/saas/team/:id/role`.
- Se conserva el `sub_rol` operativo para no perder distinciones de salón como recepción o prestador independiente; `role` es el permiso canónico y `sub_rol` la etiqueta compatible.
- Se conserva `user_id NOT NULL`: primero se crea la cuenta y luego se envía la invitación. Así el flujo actual de aceptación autenticada queda completo sin alterar el registro global de usuarios.
- La migración no modifica datos actuales ni elimina columnas de invitación anteriores. Los eventos de auditoría no tienen cascadas hacia usuarios/membresías y un trigger impide actualizarlos o borrarlos.

## 5. Verificación

- `node --check` pasó para los controladores, middleware, servicio y rutas backend modificados.
- `git diff --check` pasó.
- `dart analyze` dirigido a los modelos, proveedor y cliente API SaaS compartidos y a `team_management_screen.dart` terminó con código 0. Reportó siete avisos informativos de estilo/deprecación en la pantalla; no reportó errores en los archivos revisados.
- El análisis amplio de `packages/glow_core` encontró 153 avisos/informaciones distribuidos por el paquete y terminó con código 1; los tres archivos SaaS compartidos revisados no aparecen entre esos diagnósticos. No se corrigieron advertencias ajenas a la Fase 3.
- La publicación coordinada de backend y panel terminó en producción con commit `a8e105f`; API saludable y migración 190 aplicada (62 migraciones registradas).
- El recorrido real del correo y RLS no quedó certificado mediante invitaciones de prueba; permanece como verificación operativa pendiente.

## 6. Datos y despliegue

La migración 190, aditiva, quedó aplicada en producción por el runner de backend. El entorno staging sigue en `65534a4` y no contiene el despliegue coordinado de fases 1–3; no se usó para validación previa. No se modificaron membresías históricas en la migración.

## 7. Riesgos y rollback

- La publicación sin migración 190 provocaría fallos en las rutas nuevas; el backend solo se debe desplegar cuando el runner haya confirmado la migración.
- La no confirmación del correo deja una invitación pendiente. OWNER/ADMIN puede reintentarla desde el equipo; no se muestra el token en la API.
- Las invitaciones requieren usuario ya registrado. No hay auto-registro desde el enlace.
- Para rollback, se puede volver a la versión anterior del backend y cliente. Mantener las columnas, trigger y auditoría añadidos; no borrar historial como parte de rollback.

## 8. Pendientes y fase siguiente

- Probar el flujo completo de correo y aceptación (correo correcto/diferente, expiración, reenvío, concurrencia de asientos, cambios de rol, suspensión y reactivación) en un ambiente controlado.
- Revisar qué rutas operativas heredadas aún autorizan directamente mediante `salon_miembros` o roles de usuario y migrarlas gradualmente a guards basadas en `memberships`.
- Incorporar fases 1–3 a staging antes de usarlo como ambiente de validación de la fase 4; verificar auditoría y cuentas activas en producción.

La Fase 4 se inició después del despliegue productivo de la Fase 3; sus pruebas operativas pendientes se mantienen como riesgo conocido.
