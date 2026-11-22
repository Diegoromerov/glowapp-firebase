# API de revisión de cuentas de retiro

Todas las rutas requieren `Authorization: Bearer <token>` de una cuenta cuyo rol actual en la base sea `ADMIN`.

## Cola

`GET /api/glow-admin/payout-account-reviews?limit=50&after_provider_id=0`

Devuelve solicitudes `PENDIENTE` con número y documento enmascarados, el objetivo global `revision_sla_horas`, una `revision_estimada_at` por solicitud y `revision_vencida` para resaltar los objetivos superados. El SLA inicial es de 48 horas calendario y se configura mediante `platform_config.payout_account_review_sla_hours`. `revision_token` permite que una decisión no se aplique sobre datos que cambiaron mientras el administrador revisaba.

## Detalle

`GET /api/glow-admin/payout-account-reviews/:providerId`

Devuelve los datos completos necesarios para validar titular y destino, además del plazo objetivo y su fecha estimada. Cada consulta registra `CONSULTA_DATOS_CUENTA_RETIRO` en `audit_log` con la cuenta/documento enmascarados.

## Decisión

`POST /api/glow-admin/payout-account-reviews/:providerId/decision`

```json
{
  "decision": "APROBAR",
  "motivo": "Coincide la identidad y el destino",
  "revision_token": "<token recibido en cola o detalle>"
}
```

`decision` acepta `APROBAR` o `RECHAZAR`; el rechazo requiere un motivo de al menos 10 caracteres. Si el registro cambió o dejó de estar pendiente, responde `409` y el dashboard debe recargarlo. Ambas decisiones dejan actor, IP y estado anterior/nuevo en `audit_log` y notifican por correo verificado y push cuando están disponibles.

## Seguridad del retiro

Antes de `POST /api/wallet/withdraw`, el cliente solicita `POST /api/wallet/withdraw/authorization` con `{ "current_password": "…", "monto": 50000, "tipo_origen": "SEMANAL" }`. La respuesta incluye `authorization_id`; el código de seis dígitos se entrega solo al correo verificado y vence en 10 minutos. El retiro se confirma enviando `authorization_id` y `authorization_code` junto con monto y tipo. El código se consume una vez, se limita a cinco intentos y queda vinculado al monto, ciclo y destino exactos.

## Flujo de inscripción y cambio de cuenta

La app de proveedores presenta cuatro pasos: método, datos, confirmación por correo y revisión. Antes de pedir el código, valida en servidor la entidad, tipo y longitud del destino y los datos del titular. El OTP de cambio vence a los 10 minutos, admite hasta cinco solicitudes por IP cada 10 minutos y solo autoriza el destino cuyos datos se usaron al generarlo. La app espera 60 segundos antes de habilitar un reenvío y solicita confirmar de nuevo la identidad y los datos.

`GET /api/wallet/bank-account` devuelve `retiros_bloqueados_horas` y `retiros_bloqueados_hasta` cuando ya hay una cuenta. Al registrar o cambiar una cuenta, `POST /api/wallet/bank-account` responde con `retiros_bloqueados_hasta` y `retiros_bloqueados_horas`, además del SLA estimado de revisión. Mientras la cuenta nueva esté pendiente o dentro del periodo de protección no se pueden iniciar retiros nuevos; los retiros ya iniciados conservan el destino guardado en su solicitud. Si se pierde acceso al correo o a la cuenta anterior, el flujo dirige al prestador al Centro PQRSF para validar identidad.
