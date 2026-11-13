# Auditoría de cierre — programa de puntos, referidos y Club

**Fecha:** 13 de noviembre de 2026
**Alcance:** lo construido desde `344ac913` hasta `380da33d` (20 commits): libro de puntos, canje en tienda, referidos de un nivel, Club con escalera de niveles, aviso de subida de nivel y chip de acceso.
**Método:** ejecución real en el árbol, tests, y sondas contra producción. Nada se da por bueno sin salida medida.

---

## 1. Estado del árbol

| Elemento | Valor |
|---|---|
| Rama | `main`, limpia (sin cambios sin commitear) |
| HEAD local = `origin/main` | `380da33d` |
| Backend en producción | `380da33d` · dbMode `postgres` |
| Migraciones registradas | **21** (151 aplicada) |
| Web cliente publicada | `main.dart.js` md5 `475f408c…` |
| Commits del ciclo | 20 |

---

## 2. Lo verificado hoy (E0, medido)

### Tests

| Suite | Resultado |
|---|---|
| Backend — 14 archivos del programa | **88 passed**, 7 skipped |
| Cliente — chip, niveles, arranque, condiciones | **26 passed** |
| `flutter analyze` (glow_client) | **0 errores** |

Los 7 skipped son `pointsLedger.integration.test.js`: **solo corren con base de datos**. Ninguna prueba toca Postgres real en esta máquina.

### Producción

| Sonda | Resultado |
|---|---|
| `GET /api/health` | `380da33d`, 21 migraciones |
| `GET /api/rewards/points` sin token | **401** |
| `POST /api/xp-logs/convert-cashback` con token | **410** `CANJE_CASHBACK_DESHABILITADO` |
| `GET /r/GLOWDF52` | **302** → `https://glowapp-client.web.app/register?ref=GLOWDF52` |
| `GET /programa-puntos` (web) | **200** |
| `POST /api/store/envio/cotizacion` | **200** — envío $10.200, Bogotá, Servientrega, total $65.200 |
| `POST /api/store/checkout` con `puntos_a_canjear` y saldo 0 | **400** `No hay puntos suficientes para este canje` |
| Registro con `ref` válido (A `GLOWB0D0` → C) | **atribuido**: `invitada_por = {nombre: "Aud A", codigo: "GLOWB0D0"}` |
| Registro nuevo | **201** y **100 XP**, nivel Glow |
| Bundle de la web contiene el chip | sí, `\u274b` ×2 |

---

## 3. Defectos abiertos

### Críticos

**C-1 · `DELETE /api/auth/delete-account` → 502.** Con token válido, la lógica tarda 261 ms dentro del contenedor y no lanza; Redis y el pool están descartados. Es requisito de Apple (5.1.1(v)) y **bloquea la publicación en la App Store**. Necesita instrumentación fina: un log al entrar y al salir del handler, para saber si la petición llega.

**C-2 · Dos nombres para el mismo nivel.** El backend responde `Oro` y `Diamante` (`cuotasIA.js:39-40`); la app muestra `Gold` y `Élite` (`niveles_screen.dart:21-22`). El chip lee del backend, así que **una usuaria con 950 XP ve «Oro» en el chip y «Gold» en la pantalla del Club**. Es la misma persona, el mismo día.

### Altos

**A-1 · El chip nunca se vio con sesión real.** Está en el bundle y pasa 5 tests, pero no se ha renderizado con datos reales en pantalla. Mi navegador automatizado no consigue mantener sesión: el formulario rechaza `@glowapp.test` y Google necesita credenciales.

**A-2 · El bloque de canje no tiene test.** `store_screen.dart` calcula la previsualización del descuento en el cliente (`puntosAplicablesEn`, `pesosDe`) y el servidor la recalcula. Los tests cubren el servidor, **no el cliente**: si las dos fórmulas se separan, la clienta ve un total que no es el que se cobra.

**A-3 · La base de datos real no se prueba en ninguna suite.** Los 7 tests de integración se saltan sin base. Toda la confianza en el libro de puntos viene de mocks.

### Medios

**M-1 · La ruta limpia `/auth/login` rebota al inicio.** `/#/auth/login` funciona; `/auth/login` termina en el mapa. Los enlaces que repartimos son limpios (`/register?ref=`), así que un enlace de sesión limpio dejaría a la clienta fuera.

**M-2 · `GET /api/auth/referral-info` no dice quién se unió.** Devuelve contadores (`referidos_convertidos: 0`) pero no la lista. La invitante no puede saber si su invitada entró ni si está pendiente de compra. El dato existe (`usuarios.invitada_por`); falta exponerlo.

**M-3 · El premio de 500 puntos nunca se ha ejercido.** Requiere una compra pagada de la invitada por Wompi. La ruta está probada por partes (atribución sí, premio no).

**M-4 · El descuento positivo nunca se ha visto.** El canje se rechaza correctamente sin saldo; aplicarlo con saldo real y ver bajar el total sigue sin probar, por la misma razón: hace falta una compra.

### Bajos

**B-1 · Cuentas de prueba acumuladas en producción.** Del ciclo quedan ~10 cuentas `@glowapp.test` (`xp.*`, `xp2.*`, `nivel.*`, `cot.*`, `aud.a.*`, `aud.b.*`, `aud.c.*`). No tienen datos, pero ensucian usuarios y métricas.

**B-2 · Commit duplicado en la rama de motion.** `a58b2f5f` (el chip) quedó también en `feat/publicidad-brand-motion`; en `main` vive como `747ee97b`. Al rebasar su rama, git lo reconocerá como ya aplicado, pero conviene revisarlo antes de mezclar.

**B-3 · `main` estuvo roto y nadie lo vio.** Los commits de motion (`7d2487b1`) dejaron `glow_core` sin compilar (import mal, `placeholder`, `addListener`, archivo de tokens ausente, carpeta de assets vacía). **No hay compuerta que impida pushear código que no compila a `main`**: el hook solo vigila migraciones.

**B-4 · Planes del ciclo sin seguimiento.** `.hermes/plans/*.md` están en el árbol pero no versionados.

---

## 4. Pasos faltantes para cerrar el ciclo de verdad

1. **Una compra real de punta a punta** — sembrar puntos en una cuenta y pagar. Es lo único que prueba a la vez: el canje aplicado, el total descontado, el asiento en `points_movements`, el premio de 500 puntos a la invitante y el lote con vencimiento a 12 meses.
2. **Decidir los nombres de nivel** y alinear backend y app. Una línea de código, una decisión de marca.
3. **Instrumentar `delete-account`** con dos logs y una sonda con token real.
4. **Ver el chip en pantalla** con una cuenta con sesión.
5. **Limpiar las cuentas de prueba.**

---

## 5. Recomendaciones, por orden de retorno

### Inmediatas (esta semana)

- **Alinear los nombres de nivel** hacia `Gold`/`Élite`, que es lo que la clienta vio y aprobó en el diseño. Tocas dos líneas en `cuotasIA.js` y un test. *(C-2)*
- **Arreglar `delete-account`.** No es del programa, pero es lo único que hoy impide publicar en iOS. Dos `console.log` y una llamada con token te dicen en una tarde si la petición llega al handler. *(C-1)*
- **Borrar las cuentas de prueba.** *(B-1)*

### Antes de dar por cerrado el programa

- **Compra real con puntos.** Sin eso, todo lo demás es teoría con tests verdes. Es la prueba que convierte el 100 % reportado en un 100 % medido. *(M-3, M-4)*
- **Test del bloque de canje** con la misma tabla de casos que el servidor (mínimo $25.000, tope 15 %, bloques de 100, saldo insuficiente). Dos fórmulas que deben coincidir, y hoy solo una está vigilada. *(A-2)*
- **Listar las invitadas en `referral-info`**: nombre, fecha y estado (`pendiente` / `premiada`). Es lo que hace que invitar se sienta como algo que funciona. *(M-2)*

### Estructurales (lo que más va a doler si no se hace)

- **Compuerta de compilación en CI.** Hoy se puede pushear a `main` código que no compila; pasó y lo descubrí por casualidad, no por un aviso. Un `flutter analyze` + `flutter test` en el workflow de PRs cuesta minutos y evita que la web deje de construirse sin que nadie sepa por qué. *(B-3)*
- **Tests de integración con Postgres en CI.** Los 7 saltados son justo los que prueban el libro de puntos contra una base real: idempotencia por `clave`, vencimiento, compromiso y liberación. En mocks, un `FORCE RLS` que afecta 0 filas pasa desapercibido — y ya nos pasó dos veces. *(A-3)*
- **Un solo camino para escribir XP.** Hoy pasa por `xpService.acreditarXp` y está bien, pero nada lo impide: el siguiente que escriba `INSERT INTO xp_logs` a mano romperá el aviso de nivel en silencio, como pasó con los compartires. Un lint o una revisión explícita en el PR lo sostiene.

---

## 6. Veredicto

**El programa está completo en alcance y verificado en su mayor parte por piezas.** Lo que no está probado es exactamente lo que toca dinero: la compra que canjea puntos y el premio que se paga a la invitante.

Nada de lo abierto es un fallo de diseño; son cabos de verificación y dos defectos concretos (nombres de nivel, `delete-account`). El riesgo real del ciclo no es el programa: es que **`main` puede romperse sin que nadie se entere**, y esta semana se rompió.
