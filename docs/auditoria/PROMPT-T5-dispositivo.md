# PROMPT — T5: verificación en dispositivo Android real

> Entregar al chat desarrollador. **Hay un teléfono conectado por USB**: `24117RN76L` (Android 16, API 36, arm64, id de depuración `auzdea6lvk5dojfu`). Esta tarea es **verificar**, no rediseñar: si algo falla, se documenta con evidencia y se reporta, no se arregla de paso.

---

## 1. Estado de partida (ya comprobado, no lo repitas)

- `flutter devices` ve el teléfono: `24117RN76L • android-arm64 • Android 16 (API 36)`.
- `flutter doctor` marca **licencias de Android sin aceptar** → `flutter doctor --android-licenses` (responde `y` a todo).
- **Defecto ya detectado, entra en el alcance:** `android/app/build.gradle.kts:33` usa `signingConfig = signingConfigs.getByName("debug")`. Un APK de release sale firmado con la clave de depuración: no sirve para distribuir ni para actualizar una instalación existente. Los keystores reales están en `C:\Users\Compu casa\glowapp-split\secrets\keystores-2026-11\` (`client-upload-2026.p12` + `credentials-2026-11.env`).
- `adb` no está en el PATH; usa `$ANDROID_HOME/platform-tools/adb` o el que trae el SDK.

## 2. Qué se verifica (seis casos, cada uno con evidencia)

### Caso 1 — Compilación y firma

1. Aceptar licencias y compilar: `flutter build apk --release`.
2. Si el APK sale firmado con debug, **configurar la firma de release** desde `key.properties` (ruta del keystore fuera del repo o copiada por el build; nunca dentro del árbol versionado).
3. Verificar la firma: `apksigner verify --print-certs build/app/outputs/flutter-apk/app-release.apk` → el certificado debe ser el de upload (`client-upload-2026`), no `CN=Android Debug`.

**Evidencia:** salida de `apksigner` con el nombre del certificado. **Los passwords no se imprimen nunca**: se leen de `credentials-2026-11.env` y se escriben como `[REDACTADO]` en el reporte.

### Caso 2 — Manifiesto fusionado

```bash
$ANDROID_HOME/build-tools/<versión>/aapt2 dump xmltree --file AndroidManifest.xml app-release.apk | grep -E "uses-permission|intent-filter|scheme|host"
```

Debe contener: `INTERNET`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `POST_NOTIFICATIONS`, y los dos `intent-filter` (https con host `glowapp-client.web.app` y esquema `glowapp`).

### Caso 3 — Permiso de ubicación: los tres caminos

Instalar (`flutter install` o `adb install -r`) y ejecutar el recorrido:

1. **Concedido**: tocar «Mi ubicación» → diálogo del sistema → permitir → el mapa se centra en la posición real.
2. **Denegado en el momento**: `adb shell pm revoke <pkg> android.permission.ACCESS_FINE_LOCATION` y repetir → debe salir el aviso «Sin acceso a tu ubicación…», sin caer al centro de Bogotá en silencio.
3. **Denegado para siempre**: revocar dos veces o marcar «no volver a preguntar» → debe aparecer el diálogo con **«Abrir ajustes»** y abrir la pantalla de la app en los ajustes del sistema.

**Evidencia:** captura o video por caso, más `adb shell dumpsys package <pkg> | grep -A3 ACCESS_FINE_LOCATION` mostrando el estado del permiso.

### Caso 4 — Movimiento reducido

1. Ajustes → Accesibilidad → **Quitar animaciones** (en Android 13+ es la opción que activa `reduceMotion`).
2. Volver a la app: el mapa debe **saltar** al destino sin animación y los paneles del tutorial no deben animarse.

**Evidencia:** video de 5 s con la preferencia activada, y otro con ella desactivada (para que se vea la diferencia, no solo la ausencia).

### Caso 5 — Enlace entrante

Con una cita o prestador real:

```bash
adb shell am start -W -a android.intent.action.VIEW \
  -d "https://glowapp-client.web.app/provider-detail/<id-real>"
adb shell am start -W -a android.intent.action.VIEW \
  -d "glowapp://provider-detail/<id-real>"
```

- El esquema `glowapp://` **debe** abrir la app.
- El enlace `https://` **solo** abrirá la app si el dominio publica `https://glowapp-client.web.app/.well-known/assetlinks.json` con el SHA-256 del certificado de firma. **Comprueba primero si ese archivo existe** (`curl`). Si no existe, el resultado esperado es que abra el navegador: **no es un fallo de la app**, es un paso de publicación que falta, y se reporta como tal en lugar de darlo por roto.

### Caso 6 — Que la app no se caiga

Durante los cinco casos anteriores: `adb logcat -s flutter` y `adb logcat *:E`, buscando excepciones no capturadas. Al final, `adb shell dumpsys activity | grep -i "anr\|crash"` — sin ANR ni crash de la app.

## 3. Reglas

1. **Evidencia por caso**: captura, video o salida de comando. Un «funciona» sin eso se rechaza.
2. **No simular**: si un caso no se puede reproducir, se declara E0 con el motivo. Prohibido marcar como probado lo que no se ejecutó.
3. No arregles lo que no sea del alcance: si un caso falla, se documenta y se propone, no se corrige sobre la marcha.
4. Si tocas código (firma de release, por ejemplo), commit atómico en español, push a `main` **y** `staging`, y `flutter analyze` con 0 errores.
5. **Secretos**: keystore y contraseñas se leen de `credentials-2026-11.env`; jamás se escriben en el chat, en un commit o en una captura.
6. El hook de pre-push bloquea cambios en migraciones; esta tarea no las toca.

Autorización para cambios de código:

```
AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — GLOWAPP-CLIENTE
```

## 4. Formato del reporte

```
CASO <n> — <título>
Resultado: PASA | FALLA | E0
Evidencia: <comando y salida> · <ruta de captura/video>

Defectos encontrados
- archivo:línea — qué se vio — con qué evidencia

JSON
{"tarea":"T5","casos":{"1":"PASA","2":"PASA","3":"FALLA","4":"PASA","5":"PARCIAL","6":"PASA"},
 "evidencia":"E3","defectos":["…"],"falta":["…"]}
```

**Caso 5 se reporta como `PARCIAL`** si el esquema propio funciona y el https no, con la causa (falta `assetlinks.json`). Eso es un resultado válido y honesto; fingir que pasa no lo es.

## 5. Lo que el revisor va a comprobar

- Que el certificado del APK sea de upload y no de debug.
- Que el manifiesto fusionado conserve los cuatro permisos y los dos `intent-filter` (el ítem 14 se verificó en código, nunca en un binario).
- Que los tres caminos del permiso se probaron **por separado**, no solo el feliz.
- Que el movimiento reducido se grabó con la preferencia activada y desactivada.
- Que el `assetlinks.json` se comprobó con `curl` antes de concluir nada sobre los enlaces https.
