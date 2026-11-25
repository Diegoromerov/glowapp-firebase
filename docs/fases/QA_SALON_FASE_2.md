# Salón de QA — Onboarding fase 2

**Entorno:** producción (glowapp-provider.web.app)  
**Creado:** 24 de noviembre de 2026 (hora de Bogotá)  
**Propósito:** conservar una sede de prueba para revisar el onboarding SaaS y la configuración del salón. No usar para atender clientes ni registrar operaciones reales.

## Acceso de revisión

### Propietario del salón
- Correo: qa.fase2.202611241931@example.com
- Contraseña: compartida en la conversación privada; no se guarda en el repositorio.
- Usuario ID: 132.
- Salón ID: 17 (QA Salón Fase 2), ciudad Bogotá, plan de prueba gratuita.

### Cuenta para probar restricciones
- Correo: qa.fase2.member.202611241945@example.com
- Contraseña: compartida en la conversación privada; no se guarda en el repositorio.
- Usuario ID: 133, rol PRESTADOR sin membresía del salón 17.

Ambos correos son de dominio de ejemplo y no reciben correos, invitaciones ni restablecimientos de contraseña.

## Configuración guardada
- Lunes a viernes: 09:00–18:00.
- Sábado: 10:00–14:00.
- Domingo: cerrado.
- Aceptación de términos y política de datos: registrada para el propietario QA.
- Servicio de prueba en borrador: Servicio QA Fase 2 - No publicar (ID 53a36c9a-7048-4806-922d-c36a497abb88), precio 0, 30 minutos; no aparece publicado a clientes.

## Verificaciones en producción
1. Registro e inicio de sesión del propietario QA.
2. Creación del salón 17 y provisionamiento SaaS.
3. Guardado y posterior lectura del horario mediante GET/PATCH /api/salon/17/profile.
4. Repetir POST /api/salon/create devolvió salón 17 con created=false; no duplicó la sede.
5. Repetir POST /api/saas/bootstrap devolvió el perfil SaaS existente.
6. Petición anónima al perfil: HTTP 401.
7. Usuario PRESTADOR ajeno al salón: GET y PATCH del perfil respondieron HTTP 403; el nombre del salón quedó intacto.
8. Crear el servicio QA en borrador respondió HTTP 201 y apareció en el catálogo del propietario.
9. Hosting público responde HTTP 200 y muestra el nuevo Last-Modified tras el despliegue del cliente.

## Límites de la verificación
- Las cuentas y el salón son registros productivos persistentes solicitados para QA; se mantienen para que el dueño pueda revisarlos.
- La revisión se hizo con llamadas autenticadas a producción y una comprobación HTTP. No se completó una inspección visual fiable de móvil/escritorio con navegador interactivo en esta sesión.
- La contraseña no está dentro de este archivo ni del repositorio.