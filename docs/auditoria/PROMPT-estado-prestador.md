# PROMPT — Estado de la app PRESTADOR (glow_provider) y tareas a realizar

> Handoff para un chat nuevo. El agente **no modifica nada** hasta recibir la autorización exacta del Director.

---

## ROL Y CONTEXTO

Eres el ingeniero a cargo de la **app del prestador de GlowApp**: el profesional (manicurista, estilista, barbero) y el dueño de salón que reciben y atienden las citas que reservan los clientes.

**Repositorio:** `C:\Users\Compu casa\glowapp-firebase` (monorepo melos)
**App:** `apps/glow_provider` — 72 archivos Dart, ~38.965 líneas, 14 pantallas, 39 rutas
**Compartido:** `packages/glow_core` — todo lo que se corrige ahí beneficia también a la app de clientes
**Backend:** `backend/` → Railway `glowapp-api`
**Producción:** API `https://glowapp-api-production.up.railway.app` · Web `https://glowapp-provider.web.app`
**Ramas:** `main` (producción) · `staging` (validación)

**Documentos de referencia:**
- `docs/auditoria/baseline-2026-11-05.json` — checklist de 86 ítems usado con la app de clientes
- `docs/auditoria/comparativa-2026-11-05.md` — cómo se corrigieron en cliente (patrón reutilizable)
- `docs/auditoria/PROMPT-estado-cliente.md` — estado de la app hermana

---

## ⛔ REGLA DE ARRANQUE

**No ejecutes nada al recibir este prompt.** Tu primera respuesta: confirmar lectura, verificar el repositorio, presentar el plan de auditoría y pedir:

```
AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — GLOWAPP-PRESTADOR
```

Sin esa cadena exacta no hay commits, despliegues ni cambios de esquema. «Continúa», «sigue», «ok» no son autorización.

---

## ESTADO ACTUAL — **sin auditar**

A diferencia de la app de clientes (86 ítems medidos), **la app del prestador nunca pasó por la checklist**. Lo que sigue es lo que consta verificado y lo que ya se detectó como defecto con evidencia de código. No inventes un veredicto global: la primera tarea es auditar.

### Verificado

| Aspecto | Evidencia |
|---|---|
| Compila y pasa tests | `flutter test` → 5/5 en verde |
| Análisis estático | `dart analyze` sin errores (solo avisos) |
| Despliegue web | `https://glowapp-provider.web.app` activo, bundle desplegado |
| API correcta | Comparte `glow_core`: apunta a `glowapp-api-production` (el fallo de base URL que tuvo la web del cliente ya está corregido para ambas) |
| Invitaciones de salón | Flujo completo conservado: tarjeta, enlace de login, ruta `/auth/accept-invitation`, pantalla y `POST /api/salon/accept-invitation` |
| Perfil | Correo real del usuario (se quitó el valor quemado `valeria.gomez@glowapp.com`); métricas inventadas (350 XP, Club Gold, 100%) retiradas |
| Seguimiento de cita | Pantalla de 589 líneas con FAB de compartir ubicación, rol `provider` correcto |
| Servicio completado | `/complete` con OTP entregado en la app («Ver mi código» / «Confirmar ahora») |

### Defectos ya detectados (evidencia de código, sin ejecución en dispositivo)

| # | Defecto | Evidencia | Gravedad |
|---|---|---|---|
| P-01 | **El APK de release no tiene INTERNET** | `android/app/src/main/AndroidManifest.xml` → 0 `uses-permission` | **Crítico**: el binario no alcanza la red |
| P-02 | 77 mensajes de error crudos al usuario | `grep "Text('\$e"` sobre `lib/` | Alto: expone `SocketException`, `500`, stacks |
| P-03 | Sin borrado de cuenta | no existe `delete-account` ni pantalla equivalente | **Bloqueante de tienda** (App Store 5.1.1(v) / Play) |
| P-04 | Sin política de privacidad | solo 2 menciones sueltas | Bloqueante de tienda |
| P-05 | 70 usos del dorado `#C5A052` en texto | contraste 2,46:1 (mínimo 4,5:1) | Alto: accesibilidad |
| P-06 | Solo 2 archivos de test para 39.000 líneas | `test/` | Alto: sin red de seguridad |
| P-07 | 18 tooltips y 13 `Semantics` | iconos sin etiqueta en el resto | Medio |
| P-08 | Permisos de ubicación no declarados ni solicitados | manifiesto vacío | Crítico para el FAB de compartir ubicación |

---

## TAREAS A REALIZAR

### Tarea 0 — Auditoría (primero, sin código)

Aplicar la misma checklist de 86 ítems de `baseline-2026-11-05.json` a `apps/glow_provider`, con la escala de evidencia **E3** producción · **E2** ejecución · **E1** código · **E0** no verificable. Guardar el resultado en `docs/auditoria/baseline-prestador.json` con el mismo formato.

Añadir los ítems propios del prestador, que la checklist genérica no cubre:

- Recibir y aceptar/rechazar una solicitud de cita.
- Iniciar servicio y **compartir ubicación en vivo** durante el trayecto.
- Cerrar el servicio con el código OTP del cliente.
- Cobro y liquidación: ver cuánto entra, cuándo y con qué comisión.
- Gestión de agenda y disponibilidad (bloquear horas, vacaciones).
- Servicios y precios propios; perfiles de negocio.
- Salón: invitar colaboradores, asignar citas, ver agenda del equipo.
- Verificación de documentos (cédula, RUT, certificaciones) y su estado.
- Notificaciones de cita nueva, cambio y cancelación.

### Tarea 1 — Bloqueantes de tienda (≈1 día)

1. **P-01** — Declarar en el manifiesto de release: `INTERNET`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `POST_NOTIFICATIONS`.
2. **P-03** — Pantalla «Eliminar mi cuenta» con confirmación escrita, llamando a `DELETE /api/auth/delete-account` (el endpoint ya existe y funciona en la app hermana; reutiliza el patrón de `apps/glow_client/lib/screens/account_deletion_screen.dart`).
3. **P-04** — Pantalla de privacidad + enlace a `https://glowapp-client.web.app/privacy.html` (la política es la misma; o publica una propia si el prestador trata datos distintos).

### Tarea 2 — Robustez (≈1 día)

4. **P-02** — Sustituir los 77 `$e` visibles por `mensajeHumano(e)` (ya existe en `glow_core`).
5. Timeouts y reintentos: verificar que toda petición los tenga.
6. Estados vacíos y de carga en agenda, citas y salón.

### Tarea 3 — Accesibilidad (≈1 día)

7. **P-05** — Reemplazar el dorado de texto por `#8A6A2F` (5,02:1). Solo colores de texto; iconos y degradados se quedan.
8. **P-07** — Etiquetas (`tooltip`/`Semantics`) en iconos y botones de las pantallas principales.
9. Escalado de texto a 200 % sin recortes en las listas de citas.

### Tarea 4 — Pruebas (≈1 día)

10. **P-06** — Tests de widget para: agenda, detalle de cita, cierre con OTP, perfil. Objetivo mínimo: cubrir los flujos que mueven dinero.
11. E2E de prestador contra producción: aceptar cita → iniciar → compartir ubicación → cerrar con OTP → ver liquidación.

### Tarea 5 — Producto (a acordar con el Director)

12. Push de cita nueva y de cancelación (FCM ya está integrado en `glow_core`).
13. VAPID de push web del prestador (pendiente de configurar).
14. Consumo de `minimum_app_version`.

---

## REGLAS DE TRABAJO

1. **Evidencia primero**: E3 · E2 · E1 · E0. Sin salida de comando no hay afirmación.
2. **Nunca inventes resultados**; si algo falla, el error exacto.
3. Producción no es terreno de pruebas. Nada de cambios de esquema sin autorización específica.
4. Commits atómicos en español; push a `main` **y** `staging`.
5. Despliegue web solo con `./scripts/desplegar-web.sh glow_provider glowapp-provider`. **Nunca** `flutter build | tail && firebase deploy`: la tubería oculta el fallo de compilación y publica el bundle anterior.
6. Antes de desplegar: `dart analyze lib` con 0 errores y `flutter test` en verde.
7. Lo que se corrija en `packages/glow_core` afecta también a la app de clientes: dilo en el reporte y pruébalo en ambas.
8. Secretos siempre `[REDACTADO]`.
9. Una tarea por autorización. Al terminar: para y reporta.

---

## FORMATO DEL REPORTE

```
TAREA <n> — <título>
Autorización: AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — GLOWAPP-PRESTADOR

Cambios
- archivo:línea — qué y por qué

Verificación
- comando → salida (0 / 200 / n filas)
- bundle desplegado → texto comprobado

Impacto en la app de clientes
- <ninguno | descripción y prueba>

Hallazgos nuevos
- ...

Siguiente tarea propuesta: <...> — esperando autorización
```

## PRIMER PASO

Lee los documentos, verifica el repositorio y presenta el plan de la **Tarea 0 (auditoría)** con la lista de ítems que vas a medir y con qué comando. Luego pide:

```
AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — GLOWAPP-PRESTADOR
```

No modifiques archivos ni ejecutes comandos de escritura antes de eso.
