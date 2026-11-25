# Salón de QA — Onboarding fase 2

**Entorno:** producción (glowapp-provider.web.app)  
**Creado:** 24 de noviembre de 2026 (hora de Bogotá)  
**Propósito:** conservar una sede de prueba para revisar el onboarding SaaS y la configuración del salón. No usar para atender clientes ni registrar operaciones reales.

## Acceso de revisión

- Correo de inicio de sesión: qa.fase2.202611241931@example.com
- Contraseña: entregada en la conversación privada de Codex; no almacenarla en el repositorio.
- Rol: propietario de salón (cuenta QA).
- Salón ID: 17
- Nombre: QA Salón Fase 2
- Ciudad: Bogotá
- Dirección: Sede de prueba, no usar para atención
- Plan inicial: prueba gratuita (FREE_TRIAL).

## Configuración guardada

- Lunes a viernes: 09:00–18:00.
- Sábado: 10:00–14:00.
- Domingo: cerrado.
- Aceptación de términos y política de datos: registrada para completar el acceso de prueba.

## Verificación ejecutada

1. Registro de la cuenta con rol SALON e inicio de sesión por la API de producción.
2. Creación del salón mediante POST /api/salon/create.
3. Provisionamiento SaaS mediante POST /api/saas/bootstrap.
4. Guardado del horario mediante PATCH /api/salon/17/profile.
5. Lectura posterior con GET /api/salon/17/profile: nombre, ciudad y horario persistieron.
6. Finalización del onboarding autenticado.

## Notas

- La cuenta usa un correo de dominio de ejemplo, sin buzón para recibir invitaciones o restablecimientos. La contraseña de acceso se conserva en el hilo de Codex.
- El salón y la cuenta son registros productivos persistentes creados expresamente para QA. No se eliminaron para que el dueño pueda seguir revisando la app.
- La prueba ejercitó los endpoints productivos. La revisión visual completa en móvil/escritorio y el flujo desde la interfaz gráfica aún requieren inspección manual.