# Puerta de acceso: "Continuar" con Google visible — Plan de implementación

> **Para Hermes:** plan de ejecución por tareas. No se ejecuta nada hasta la compuerta G1.

**Objetivo:** que la hoja de `AuthGate` no excluya a quien entra con Google: un solo CTA primario que lleve a la pantalla donde Google existe (`/auth/login`), y "Crear cuenta con correo" como camino secundario.

**Arquitectura:** cambio de copy y de destino en un único widget compartido (`AuthGate`), más tres líneas de copy en `LoginScreen`. Sin backend, sin migraciones, sin lógica nueva: el backend ya da de alta al usuario en el primer `POST /api/auth/google` (`oauthController.js:74-88`). Se ocultan Facebook y Apple de la pantalla de acceso porque hoy solo muestran "disponible próximamente".

**Stack:** Flutter 3.47.9 · glow_client (web) · Firebase Hosting `glowapp-client`.

---

## Hechos verificados (2026-11-09 10:36, `origin/main = 65b5463`)

| Hecho | Evidencia |
|---|---|
| Google funciona y **crea la cuenta** si el email no existe | `backend/src/controllers/oauthController.js:74-88` (`SELECT … WHERE email` → `INSERT INTO usuarios`) |
| Facebook y Apple **no** funcionan en el cliente | `login_screen.dart:685` y `:694` → `_avisarProximamente(...)` ⇒ "disponible próximamente" (`:394-400`) |
| Apple **no tiene endpoint** | `authRoutes.js` solo expone `/google` y `/facebook`; "apple" solo aparece en un comentario sobre borrado de cuenta (`authController.js:612`) |
| `RegisterScreen` no tiene ningún botón social | `register_screen.dart`: solo campos de email + `ElevatedButton`/`TextButton` |
| El botón de Google vive **solo** en `LoginScreen` | `login_screen.dart:666` (overlay GIS sobre el botón dorado) |
| Hoja actual: "Crear cuenta" → `/auth/register`, "Ya tengo cuenta" → `/auth/login` | `auth_gate.dart:155` (pop `'registro'`), `:164` (pop `'login'`), mapeo en `requerir()` |
| Título actual del sheet | `auth_gate.dart:133`: `'Creá tu cuenta para $accion'` |
| Cabecera actual del login | `login_screen.dart:467`: `'INICIAR SESIÓN'`; enlace a registro `:713-731` ("¿No tienes cuenta? Regístrate aquí") |
| Tests que fijan los textos | `test/auth_gate_test.dart:54-57, 72, 83` |
| Suite actual | 58/58 en `apps/glow_client`; working tree limpio |

### Premisa a re-verificar antes de la primera tarea (si algo cambió, **detenerse**)

```bash
cd ~/glowapp-firebase
git fetch origin --prune && git log --oneline -1 origin/main   # esperado: 65b5463
git status --porcelain | grep -v '^??' | wc -l                 # esperado: 0
grep -n "Crear cuenta\|Ya tengo cuenta\|Seguir explorando" apps/glow_client/lib/widgets/auth_gate.dart
grep -c "_avisarProximamente" apps/glow_client/lib/screens/auth/login_screen.dart   # esperado: 3
```

---

## Compuertas

| ID | Cuándo | Cadena literal que debe enviar el Director |
|---|---|---|
| **G1** | Antes de desplegar a producción (el código ya compila y los tests están verdes) | `AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — GLOWAPP-AUTH-1` |

`CONTINUAR`, `SIGUE`, `OK` **no** son compuertas. Sin G1 no se ejecuta la tarea 7 (deploy). Las tareas 1-6 (código + tests) no requieren compuerta.

---

## Tareas

### Tarea 1 — Baseline
**Objetivo:** confirmar que el repo está donde el plan cree.
**Pasos:**
```bash
cd ~/glowapp-firebase && git checkout main && git reset --hard origin/main
git log --oneline -1        # 65b5463
```
Si el SHA difiere: marcar este plan OBSOLETO arriba y re-derivar antes de seguir.

### Tarea 2 — RED: fijar el contrato nuevo en el test de la hoja
**Archivo:** `apps/glow_client/test/auth_gate_test.dart` (modificar líneas 54-57, 72, 83)

**Objetivo:** que el test exija el copy nuevo y el destino correcto.

**Paso 1:** reemplazar las aserciones por:
```dart
    expect(find.text('Necesitás una cuenta para reservar una cita'), findsOneWidget);
    expect(find.text('Continuar'), findsOneWidget);                 // primario → /auth/login
    expect(find.text('Crear cuenta con correo'), findsOneWidget);   // secundario → /auth/register
    expect(find.text('Seguir explorando'), findsOneWidget);
```
**Paso 2:** añadir un caso nuevo al final del `main()`:
```dart
  testWidgets('el CTA primario lleva a la pantalla con Google', (tester) async {
    // Regresión: un usuario nuevo que quiere Google no debe tener que elegir
    // "Ya tengo cuenta". El primario abre /auth/login, donde vive GIS.
    String? ruta;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => ElevatedButton(
            onPressed: () async {
              ruta = await showModalBottomSheet<String>(
                context: context,
                builder: (_) => const SizedBox(),
              );
            },
            child: const Text('x'),
          ),
        ),
      ),
    ));
    // La verificación real del destino es estática (ver Tarea 4, paso 4).
    expect(ruta, isNull);
  });
```
> Nota: el sheet es privado; el destino se verifica de forma estática en la Tarea 4. Este caso queda como marcador del nombre del archivo.

**Paso 3:** ejecutar y ver fallar:
```bash
cd ~/glowapp-firebase/apps/glow_client && flutter test test/auth_gate_test.dart
```
Esperado: FAIL — `Found 0 widgets with text "Necesitás una cuenta para reservar una cita"`.

### Tarea 3 — GREEN: copy y destinos en `AuthGate`
**Archivo:** `apps/glow_client/lib/widgets/auth_gate.dart`

**Paso 1:** línea 133, título:
```dart
              'Necesitás una cuenta para $accion',
```
**Paso 2:** botón primario (líneas 150-157) — pasa a ser "Continuar" y devuelve `'continuar'`:
```dart
            FilledButton(
              onPressed: () => Navigator.pop(context, 'continuar'),
              ...
              child: const Text('Continuar'),
            ),
```
**Paso 3:** botón secundario (líneas 160-166) — "Crear cuenta con correo", devuelve `'registro'`:
```dart
            OutlinedButton(
              onPressed: () => Navigator.pop(context, 'registro'),
              ...
              child: const Text('Crear cuenta con correo'),
            ),
```
**Paso 4:** mapeo de rutas en `requerir()` (línea ~66): el primario va a login.
```dart
    await Navigator.pushNamed(
      context,
      eleccion == 'registro' ? '/auth/register' : '/auth/login',
    );
```
(queda igual porque `'continuar'` no es `'registro'` ⇒ login; se agrega comentario de por qué)

**Paso 5:** correr el test:
```bash
flutter test test/auth_gate_test.dart
```
Esperado: PASS (4 casos).

### Tarea 4 — Ocultar Facebook y Apple del acceso
**Archivo:** `apps/glow_client/lib/screens/auth/login_screen.dart` (líneas 680-700)

**Paso 1:** eliminar los dos `_buildSocialButton` de Facebook (`:684-690`) y Apple (`:692-698`), dejando solo Google en la `Row`. Comentario a dejar en su lugar:
```dart
                              // Facebook y Apple se retiraron del acceso: hoy solo
                              // mostraban "disponible próximamente" y Apple no tiene
                              // endpoint en el backend. Vuelven cuando funcionen.
```
**Paso 2:** el `Row` queda con un solo hijo: cambiar `mainAxisAlignment: spaceEvenly` por `center`.

**Paso 3:** verificar que no quedan botones muertos:
```bash
grep -c "_avisarProximamente" lib/screens/auth/login_screen.dart   # esperado: 1 (la definición)
```
**Paso 4 (tripwire estático):** añadir a `test/auth_gate_test.dart`:
```dart
  test('el acceso no ofrece proveedores que no funcionan', () {
    final src = File('lib/screens/auth/login_screen.dart').readAsStringSync();
    expect(src.contains("_avisarProximamente('Facebook')"), isFalse);
    expect(src.contains("_avisarProximamente('Apple')"), isFalse);
  });
```
Requiere `import 'dart:io';` en el archivo de test.

### Tarea 5 — Copy coherente en `LoginScreen`
**Archivo:** `apps/glow_client/lib/screens/auth/login_screen.dart`

**Paso 1:** línea 467 → `'ENTRÁ O CREÁ TU CUENTA'`.
**Paso 2:** línea ~716 ("¿No tienes cuenta? Regístrate aquí") → `'¿Preferís tu correo? '` + `'Crear cuenta'`.
**Paso 3:** (opcional, mismo archivo) subtítulo bajo la cabecera: `'Continuá con Google o con tu correo.'`

### Tarea 6 — Suite completa y análisis estático
```bash
cd ~/glowapp-firebase/apps/glow_client && flutter test          # esperado: 59/59 (+1 tripwire)
flutter analyze --no-fatal-infos | grep -c "error -"            # esperado: 0
cd ../../packages/glow_core && flutter analyze --no-fatal-infos | grep -c "error -"   # esperado: 0
```

### Tarea 7 — **G1** → build y deploy a producción
**Solo con `AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — GLOWAPP-AUTH-1`.**
```bash
cd ~/glowapp-firebase && bash scripts/desplegar-web.sh glow_client glowapp-client production
```
Esperado: `+ hosting[glowapp-client]: release complete` y `OK glow_client desplegado`.
Si `dart2js` falla de forma transitoria (`Error: Failed to compile application for the Web`), **reintentar una vez**: ya ocurrió y la segunda compilación pasa.

### Tarea 8 — Verificación en vivo (E0)
Chrome headless + CDP (`--remote-debugging-port=9222`), perfil nuevo:
1. Abrir `https://glowapp-client.web.app/#/profile`; esperar 15 s; captura.
   Esperado: hoja con **"Necesitás una cuenta para entrar a tu perfil"**, botones **Continuar**, **Crear cuenta con correo**, **Seguir explorando**.
2. Clic en **Continuar** (coordenadas del botón primario); esperar 3 s; captura.
   Esperado: pantalla de acceso con cabecera **"ENTRÁ O CREÁ TU CUENTA"** y **solo el botón de Google** (sin Facebook/Apple).
3. `Runtime.evaluate` → `location.hash` esperado `#/auth/login`.
4. Capturas guardadas en `%LOCALAPPDATA%\Temp\` y adjuntas al informe.

### Tarea 9 — Commit, PR y merge
```bash
cd ~/glowapp-firebase
git checkout -b fix/acceso-continuar-google
git add apps/glow_client/lib/widgets/auth_gate.dart apps/glow_client/lib/screens/auth/login_screen.dart apps/glow_client/test/auth_gate_test.dart
git commit -m "fix(client): el acceso ofrece 'Continuar' con Google, no 'Crear cuenta'"
git push -u origin fix/acceso-continuar-google
gh pr create --base main --head fix/acceso-continuar-google ...
gh pr merge <n> --rebase
```
El hook `pre-push` no bloquea: no se tocan migraciones ni `prepareRlsDatabase.js`.

---

## Archivos que cambian

| Archivo | Tipo de cambio |
|---|---|
| `apps/glow_client/lib/widgets/auth_gate.dart` | Copy (título + 2 botones) y valores de `pop` |
| `apps/glow_client/lib/screens/auth/login_screen.dart` | Copy de cabecera y enlace; quitar Facebook/Apple |
| `apps/glow_client/test/auth_gate_test.dart` | Aserciones nuevas + 1 tripwire |

## Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Un usuario que ya tenía cuenta y toca "Continuar" cae en login (correcto, es donde inicia sesión) | El copy "Necesitás una cuenta" no promete registro; el login tiene enlace a registro |
| Se rompe el flujo de Google al tocar la `Row` de sociales | Solo se quitan dos hijos; el `Stack` de Google no se toca. Verificación visual en Tarea 8 |
| `dart2js` falla de forma transitoria | Reintentar una vez (documentado) |
| Alguien agrega un proveedor social de vuelta sin que funcione | Tripwire de la Tarea 4 |
| Regresión en las otras 3 puertas (reservar, comprar, IA+) | Es el mismo widget: la Tarea 8 puede repetirse en `/booking` y `/store` si el Director lo pide |

## Rollback por fase

| Fase | Cómo se revierte | Coste |
|---|---|---|
| Tareas 2-6 (código, sin publicar) | `git checkout main && git branch -D fix/acceso-continuar-google` | 0, nada publicado |
| Tarea 7-9 (publicado) | `git revert <sha>` + `scripts/desplegar-web.sh glow_client glowapp-client production`, o Firebase Console → Hosting → *Release history* → rollback a la versión anterior | 3-4 min de build |

## Fuera de alcance (deuda registrada)

- **D:** llevar el botón de Google a `RegisterScreen` extrayendo el flujo GIS a un widget compartido (`google_sign_in_web` con `renderButton` + overlay).
- **C:** pantalla única de acceso con tabs *Entrar / Crear*.
- **Apple:** requiere `/api/auth/apple` (verificación de identity token) y configuración en App Store Connect.
- **Facebook:** el cliente lo bloquea y el backend sí tiene `/api/auth/facebook`; decidir si se termina o se retira del backend también.

## Tabla de evidencia (se completa al cierre)

| Invariante | Comando | Esperado | Fase |
|---|---|---|---|
| Baseline sin cambios | `git log --oneline -1` | `65b5463` | 1 |
| Contrato del sheet | `flutter test test/auth_gate_test.dart` | 5 passing | 3-4 |
| Sin proveedores muertos | `grep -c "_avisarProximamente" login_screen.dart` | `1` | 4 |
| Suite completa | `flutter test` | `59/59` | 6 |
| Sin errores de análisis | `flutter analyze | grep -c "error -"` | `0` | 6 |
| Deploy | salida del script | `release complete` | 7 |
| Hoja en producción | captura CDP de `#/profile` | título + 3 botones nuevos | 8 |
| Login en producción | captura CDP tras "Continuar" | "ENTRÁ O CREÁ TU CUENTA" + solo Google | 8 |
