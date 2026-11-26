# Onboarding SaaS — Fase 5: Puesta en marcha operativa

**Corte:** 26 de noviembre de 2026  
**Avance estimado:** 65 % implementado localmente; aún no desplegado ni validado de extremo a extremo.

## Objetivo y criterio de cierre

Guiar al salón desde su configuración hasta su primera operación. La fase se cierra cuando un cliente crea una reserva, esta aparece en la agenda correcta y el prestador completa la atención dentro del sistema.

## Hallazgos previos

- La pestaña Agenda del shell SaaS ya consultaba las reservas del salón activo.
- Si no había citas, mostraba solo un mensaje informativo, sin guiar a la persona propietaria a completar la puesta en marcha.
- Servicios disponía de una instrucción básica para crear el primer servicio.
- La agenda del dashboard del prestador ya tenía filtros y acciones para operar reservas, pero el acceso desde el shell SaaS no abría esa pestaña directamente y su consulta no recibía el identificador del salón.

## Trabajo implementado en el checkout local

1. El estado vacío de Agenda ahora presenta cuatro pasos: revisar el perfil del salón, configurar disponibilidad semanal, publicar un servicio y recibir una reserva desde GlowApp.
2. Cada paso dirige a su pantalla existente. La guía ofrece un acceso a «Ver cómo atender citas».
3. `ProviderDashboardScreen` acepta una pestaña inicial y un `salonId`; el acceso de la guía abre la Agenda y solicita las reservas con el salón activo.
4. La guía comunica que la reserva se genera desde la app del cliente; no simula ni crea citas desde la app del prestador.

## Evidencia y límites

- Archivos modificados: `apps/glow_provider/lib/screens/salon/salon_shell.dart` y `apps/glow_provider/lib/screens/provider/provider_dashboard_screen.dart`.
- Validación estática: `flutter analyze --no-pub --no-fatal-infos --no-fatal-warnings` terminó correctamente conforme a la configuración del proyecto. El análisis reportó numerosos avisos e informaciones de lint en la app (1.345 en total), incluidos avisos preexistentes; no se reportaron errores fatales.
- Suite existente: `flutter test` terminó correctamente con **15/15 pruebas**. No hay aún una prueba widget focalizada para la nueva guía.
- El build release web está pendiente de la integración y del workflow de publicación.
- No se desplegó a producción. El usuario indicó que no hay una segunda cuenta disponible; además, el salón QA existente conserva un servicio de prueba y no está destinado a operaciones reales. Por eso no se insertó una cita persistente.
- La verificación de reservas se debe completar con una cuenta cliente de QA distinta y una cita de prueba controlada, incluyendo la confirmación/inicio y el cierre de la atención según los controles disponibles.

## Pendientes para cerrar la fase

- Dar formato y revisar estáticamente los cambios.
- Desplegar a producción después de integrar la versión revisada.
- Ejecutar el recorrido autenticado Cliente → reserva → agenda del salón y comprobar que la cita pertenece al `salonId` correcto.
- Completar el flujo de atención de la cita y registrar evidencia de los estados antes/después.
- Limpiar o cancelar la cita de prueba con el mecanismo normal de la app, si el estado final lo permite.

**Estado:** abierta. El 65 % corresponde al trabajo de interfaz y conexión local demostrado; no representa despliegue ni validación del criterio de cierre.
