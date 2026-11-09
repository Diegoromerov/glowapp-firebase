# PROMPT — Continuar T5 (verificación en dispositivo Android) · GlowApp

> Entregar íntegro a un agente con acceso al sistema de archivos de esta máquina. La tarea es **verificar**, no rediseñar. El objetivo no es «que compile»: es producir evidencia de seis casos concretos.

---

## 1. Objetivo

Cerrar la tarea **T5** de la auditoría de prelanzamiento de la app de clientes de GlowApp: compilar un APK de release correctamente firmado, instalarlo en el teléfono conectado por USB y verificar seis comportamientos, con evidencia por cada uno.

## 2. Dónde está toda la información

| Qué | Ruta |
|---|---|
| **Plan de T5 y los seis casos** (leer primero) | `C:\Users\Compu casa\glowapp-firebase\docs\auditoria\PROMPT-T5-dispositivo.md` |
| Documento de handoff general del proyecto | `docs/auditoria/PROMPT-desarrollador-pendientes.md` |
| Diagnóstico de migraciones (T4, ya cerrado) | `docs/auditoria/PROMPT-T4-pasos-2-4.md` |
| Repo de trabajo principal | `C:\Users\Compu casa\glowapp-firebase` (rama `main`, commit `30dee1a`) |
| **Copia de trabajo sin espacios en la ruta** (para compilar) | `C:\glow\repo` (worktree, mismo commit) |
| Caché de paquetes sin espacios | `C:\pubcache` (junction → `C:\Users\Compu casa\.pub-cache`) |
| Script de verificación ya escrito | `C:\glow\t5-verificar.sh` |
| Logs de los intentos de build | `C:\glow\build.log` … `build6.log` |
| NDK 28.2 descargado (completo, sin descomprimir) | `D:\ndk-r28c.zip` (713 MB, descarga terminada, `EXIT=0`) |
| NDK antiguos corruptos (apartados) | `D:\Android\ndk-roto\` |
| SDK de Android | `D:\Android\Sdk` (build-tools 37.0.0, platform-tools, cmake 3.22.1, NDK 27 completo) |
| Flutter | `C:\flutter` — 3.47.9, la versión que espera el repo |
| Keystore de firma | `C:\Users\Compu casa\glowapp-split\secrets\keystores-2026-11\client-upload-2026.p12` · credenciales en `credentials-2026-11.env` |

## 3. Estado verificado (no lo repitas)

| Comprobación | Estado |
|---|---|
| Flutter 3.47.9 responde | ✅ |
| Licencias de Android aceptadas | ✅ |
| SDK en `D:\Android\Sdk`, `adb` operativo | ✅ |
| Teléfono conectado: `24117RN76L` · Android 16 (API 36) · arm64 | ✅ |
| `flutter pub get` en `C:\glow\repo\apps\glow_client` con `PUB_CACHE=C:\pubcache` | ✅ «Got dependencies!» |
| `android/key.properties` existe (firma de release, ya no usa la clave de debug) | ✅ |
| Compilación del APK | ❌ **bloqueada** |

**Por qué falla el build, exactamente:**

```
Execution failed for task ':jni:configureCMakeRelWithDebInfo[arm64-v8a]'
com.android.builder.sdk.InstallFailedException: Failed to install the following SDK components:
      ndk;28.2.13676358 NDK (Side by side) 28.2.13676358
```

El paquete `jni` (dependencia transitiva de `path_provider_android` y `shared_preferences_android`) usa `ndkVersion = flutter.ndkVersion`, y Flutter 3.47.9 pide **NDK 28.2.13676358**. En esta máquina solo había un 27 completo; los tres directorios 28.2 estaban a medias (sin `clang.exe`) y se movieron a `D:\Android\ndk-roto\`.

## 4. Lo que falta, en orden

### Paso 1 — Instalar el NDK 28.2 (la descarga ya está hecha)

```bat
powershell -NoProfile -Command "Expand-Archive -Path D:\ndk-r28c.zip -DestinationPath D:\ndk-tmp -Force"
```

El zip contiene una carpeta `android-ndk-r28c`. Hay que dejar su contenido en la ruta que espera el SDK:

```bat
mkdir "D:\Android\Sdk\ndk\28.2.13676358"
xcopy /E /I /Y "D:\ndk-tmp\android-ndk-r28c\*" "D:\Android\Sdk\ndk\28.2.13676358\"
```

**Comprobación obligatoria** antes de seguir: debe existir
`D:\Android\Sdk\ndk\28.2.13676358\toolchains\llvm\prebuilt\windows-x86_64\bin\clang.exe`.
Si no existe, el NDK quedó incompleto y el build volverá a fallar con «C compiler identification is unknown».

### Paso 2 — Compilar

```bat
cd C:\glow\repo\apps\glow_client
set PUB_CACHE=C:\pubcache
flutter build apk --release --target-platform android-arm64 > C:\glow\build7.log 2>&1
echo %ERRORLEVEL%
```

Tarda 5-10 minutos. **`%ERRORLEVEL%` debe ser 0.** Si falla:

```bat
findstr /C:"What went wrong" /C:"error:" C:\glow\build7.log
```

y adjunta esas líneas con las 15 siguientes al reporte.

### Paso 3 — Verificar la firma (esto es el caso 1 de T5)

```bat
"D:\Android\Sdk\build-tools\37.0.0\apksigner.bat" verify --print-certs ^
  C:\glow\repo\apps\glow_client\build\app\outputs\flutter-apk\app-release.apk
```

Tiene que aparecer el certificado de **upload** (`client-upload-2026`). Si dice `CN=Android Debug`, la firma está mal y hay que revisar `android/key.properties` antes de continuar.

### Paso 4 — Ejecutar el guion de verificación

```bash
bash C:\glow\t5-verificar.sh "C:/glow/repo/apps/glow_client/build/app/outputs/flutter-apk/app-release.apk"
```

Cubre automáticamente: firma, manifiesto fusionado dentro del binario (permisos + `intent-filter`), instalación, arranque, estado del permiso de ubicación, los dos enlaces (`glowapp://` y `https://`) y `logcat` buscando crashes.

### Paso 5 — Los casos que requieren manos en el teléfono

Los casos 3 (los tres caminos del permiso), 4 (movimiento reducido) y el resultado visual del 5 necesitan interacción. Están descritos con su criterio en `docs/auditoria/PROMPT-T5-dispositivo.md`. Para cada uno: captura o video, y el comando que lo respalda.

- Permiso denegado en el momento: `adb shell pm revoke com.glowapp.glow_client android.permission.ACCESS_FINE_LOCATION`
- Movimiento reducido: Ajustes → Accesibilidad → **Quitar animaciones**. Grabar con la preferencia activada **y** desactivada.
- Enlace `https://`: antes de concluir nada, comprobar `curl -I https://glowapp-client.web.app/.well-known/assetlinks.json`. Si no existe, el enlace https **no** abrirá la app y eso **no es un fallo de la app**: el resultado es `PARCIAL` con esa causa.

## 5. Criterios de aceptación

| Caso | Qué debe verse |
|---|---|
| 1 | APK compilado y firmado con el certificado de upload |
| 2 | Manifiesto fusionado con INTERNET, ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, POST_NOTIFICATIONS y los dos `intent-filter` |
| 3 | Los tres caminos del permiso se comportan distinto y se explican; `denegadaParaSiempre` abre los ajustes |
| 4 | Con movimiento reducido el mapa salta sin animar; sin él, anima |
| 5 | `glowapp://` abre la app; `https://` según `assetlinks.json` |
| 6 | Sin crashes ni ANR en `logcat` |

## 6. Reglas

1. **Evidencia por caso.** Captura, video o salida de comando. «Funciona» sin eso se rechaza.
2. **No inventar.** Lo que no se pueda reproducir se declara `E0` con el motivo.
3. **Producción no se toca.** Nada de desplegar ni de tocar la base de datos. El hook de `pre-push` bloquea cambios en migraciones sin `MIGRACIONES_VERIFICADAS=1`; en esta tarea no hay que tocar migraciones.
4. **Secretos**: el keystore y sus contraseñas se leen de `credentials-2026-11.env`; jamás se escriben en el reporte, en un commit ni en una captura.
5. **Si hay que cambiar código** (build, firma), commit atómico en español, push a `main` **y** `staging`, `flutter analyze` con 0 errores. Nada de arreglos colaterales.

## 7. Trampas ya pagadas — no las repitas

1. **La ruta del usuario tiene un espacio** (`C:\Users\Compu casa`). Por eso se compila desde `C:\glow\repo` con `PUB_CACHE=C:\pubcache`. No muevas nada de vuelta.
2. **Los NDK 28.2 que había estaban corruptos** (sin `clang.exe`). Están en `D:\Android\ndk-roto`. No los devuelvas a `D:\Android\Sdk\ndk`.
3. **No intentes forzar el NDK 27 por Gradle.** Se probaron tres variantes (`afterEvaluate` dentro de `subprojects`, `gradle.beforeProject` con lambda, y con `Action`) y las tres fallan: la primera porque el proyecto ya está evaluado, las otras por inferencia de tipos en Kotlin DSL. La solución correcta es tener el NDK 28.2.
4. **No uses `sdkmanager` para bajar el NDK**: falló dos veces a mitad («Failed to download package!»). La descarga directa por `curl -C -` funcionó.
5. **`flutter build | tail` oculta el código de salida.** Redirige a un log y mira `%ERRORLEVEL%`/`$?`.

## 8. Formato del reporte

```
T5 — verificación en dispositivo
Commit: <hash>   APK: <ruta>   Firma: <DN del certificado>

CASO <n> — <título>
Resultado: PASA | FALLA | E0
Evidencia: <comando y salida> · <ruta de captura/video>

Defectos encontrados
- archivo:línea — qué se vio — con qué evidencia

JSON
{"tarea":"T5","casos":{"1":"PASA","2":"PASA","3":"…","4":"…","5":"…","6":"…"},
 "evidencia":"E3","defectos":["…"],"falta":["…"]}
```


---

## 9. Actualización 2026-11-06 (intentos posteriores a la primera versión)

Estas cosas se probaron **después** de escribir el documento y fallaron. No las repitas:

1. **El zip del NDK desapareció.** `D:\ndk-r28c.zip` llegó al 95 % y luego ya no existía. Coincide con que **`D:` está al 99 % (7,4 GB libres)**. Antes de volver a descargar 713 MB, libera espacio o descarga en `C:` (19 GB libres).
2. **Hay un NDK 28.2 falso en `D:\Android\Sdk\ndk\28.2.13676358`**: 1 MB, sin `source.properties`. Lo dejó un intento de auto-instalación de AGP. Borra ese directorio antes de instalar el de verdad; mientras exista, el error es `[CXX1101] NDK at … did not have a source.properties file`.
3. **Forzar el NDK 27 por `dependency_overrides` no funciona en este repo.** GlowApp es un workspace de pub: los overrides hay que ponerlos en el `pubspec.yaml` de la **raíz** (`C:\glow\repo\pubspec.yaml`), no en el de la app. Se añadieron `path_provider_android: 2.2.17` y `shared_preferences_android: 2.3.2` en la raíz y aun así `jni` siguió en el lock: esos plugins mantienen la dependencia o pub no bajó de versión. Si quieres insistir por ahí, comprueba con `dart pub deps --style=compact | grep jni` **antes** de compilar.
4. **El camino corto sigue siendo el NDK 28.2 real.** Todo lo demás son rodeos que ya costaron cuatro builds fallidos (~2 min cada uno una vez caliente Gradle).
5. El worktree `C:\glow\repo` tiene cambios locales sin commitear (overrides en `pubspec.yaml` de la raíz y de la app). Si se retoma por la vía del NDK, conviene revertirlos con `git checkout -- pubspec.yaml apps/glow_client/pubspec.yaml` para no arrastrar versiones viejas de los plugins.

**Estado del goal:** el APK no se ha compilado. Falta exclusivamente el NDK 28.2 instalado y verificado (`toolchains/llvm/prebuilt/windows-x86_64/bin/clang.exe` + `source.properties`).
