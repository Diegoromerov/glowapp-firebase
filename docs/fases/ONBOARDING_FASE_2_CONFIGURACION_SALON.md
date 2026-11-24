# Onboarding SaaS — Fase 2: configuración inicial del salón

**Estado:** implementación preparada en el checkout; pendiente de despliegue y validación operativa en producción.  
**Alcance:** recopilar y mantener los datos básicos, ubicación y horario comercial de una sede, y permitir completar su catálogo de servicios desde el módulo existente.

## Trabajo realizado

- El alta de salón ya captura nombre, identificación tributaria, dirección, ciudad, teléfono y ubicación en el mapa.
- Se añadió al onboarding un editor opcional del horario general de apertura por día. El horario de apertura del establecimiento queda separado de la disponibilidad individual de cada profesional, que sigue en `perfiles_prestador.weekly_schedule`.
- Se agregó `salones.horario_atencion` como campo JSONB nullable mediante la migración aditiva 198. Una sede puede completar el horario después del registro.
- Se agregó `PATCH /api/salon/:salonId/profile`, protegido por autenticación y el guard de propietario/administrador. Valida los horarios, limita longitudes de campos y sincroniza nombre/ciudad con el perfil SaaS dentro de una transacción de sistema.
- `GET /api/salon/:salonId/profile` devuelve los datos y el horario de la sede seleccionada; evita confundirlos en cuentas con más de una sede.
- Se agregó una pantalla para editar nombre, identificación tributaria, ciudad, dirección, teléfono y horario sin crear otra sede. Está enlazada desde «Más» en el panel del salón.
- La pantalla de perfil ofrece un acceso directo a la pestaña «Servicios», que ya permite administrar el catálogo inicial.
- La actualización posterior al alta es repetible: si falla, el salón existente puede reabrir el perfil y guardar los datos sin volver a registrarse.

## Decisiones de alcance

- El horario aquí guardado es el horario comercial general. No reemplaza ni sobrescribe los horarios individuales del personal.
- Los datos tributarios y de ubicación pueden quedar incompletos durante el alta y completarse después.
- Los servicios se administran desde el catálogo ya existente del panel. Esta fase no crea servicios ficticios ni cambia las reglas existentes para publicar servicios.

## Pendiente para cerrar la fase

1. Publicar backend y cliente con la migración 198 en producción.
2. Verificar en producción alta nueva con horario, actualización del perfil de una sede ya existente y persistencia al volver a cargar.
3. Confirmar que un usuario que no sea propietario/administrador no puede modificar datos de otra sede.
4. Recorrer el alta, abrir la pestaña Servicios, crear el primer servicio con los requisitos actuales y comprobar que el registro no se duplica si se reintenta.
5. Revisar la pantalla en móvil y escritorio, incluyendo siete días, horarios cerrados y mensajes de validación.

## Evidencia local

- Cliente Dart formateado con `dart format`.
- Controlador y rutas validados con `node --check`.
- No se ejecutaron pruebas automatizadas ni se aplicó la migración en producción en esta entrega.
