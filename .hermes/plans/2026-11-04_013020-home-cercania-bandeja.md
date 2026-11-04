# Home de cercanía con bandeja (móvil)

Fecha: 2026-11-04
Repo: `C:/Users/Compu casa/glowapp-firebase`
App: `apps/glow_client`

## Goal

Convertir el home de `providers_screen.dart` en un mapa con **bandeja persistente de resultados ordenados por cercanía real**, pines jerarquizados (destacado / punto / cluster), radio adaptativo que nunca devuelve vacío y un modo «ver como lista» sin mapa.

## Current context / assumptions

Lo que ya existe y **se reutiliza** (no reinventar):

| Pieza | Dónde | Estado |
|---|---|---|
| Mapa | `apps/glow_client/lib/screens/providers_screen.dart:1886` (`FlutterMap` 7.0.2 + `latlong2` 0.9.1) | funciona |
| Modelo con distancia | `packages/glow_core/lib/src/models/provider_model.dart` → `distanceMeters`, `latitude`, `longitude`, `ratingAvg`, `ratingCount` | ya trae lo necesario |
| API con radio | `backend/src/controllers/providerController.js:17-35` → `?lat&lon&radius`, `ST_DWithin`, `ORDER BY distance_meters` | el backend **ya** soporta radio |
| Fetch | `packages/glow_core/lib/src/services/api_service.dart:439` `fetchProvidersSecured({latitude, longitude})` | **falta** el parámetro `radius` |
| Tutorial del home | `providers_screen.dart` — `_tutorialStep` (18 referencias), `_animatedMapMove` | **no romperlo** |

Supuestos:

- No se añade ninguna dependencia nueva: el agrupado de pines se escribe en Dart puro (~60 líneas, testeable). Los paquetes de clustering para `flutter_map` 7 obligan a fijar versiones y a reescribir el `MarkerLayer`.
- No existe todavía dato de «próximo hueco disponible» por prestador en el payload. Por eso el orden es **cercanía → nota**, y la disponibilidad queda como pregunta abierta (ver Risks).
- El archivo tiene 2.839 líneas: los cambios se hacen en archivos nuevos y en puntos concretos, sin reescribirlo.

## Architecture / proposed approach

Tres piezas nuevas, cada una con su test, y una integración mínima:

1. `lib/utils/map_clustering.dart` — funciones **puras** (sin Flutter): agrupar pines por proximidad en píxeles y decidir cuáles son destacados.
2. `lib/widgets/home_results_sheet.dart` — bandeja arrastrable de 3 posiciones que recibe la lista ya ordenada y emite `onSelect(provider)` y `onExpand(estado)`.
3. En `providers_screen.dart`: se calcula la lista ordenada una sola vez, se le pasa a la bandeja, se pintan los pines por niveles y se añade el interruptor «ver como lista».

## Step-by-step tasks

### T1 — Función de agrupado: test primero

Archivo nuevo: `apps/glow_client/test/map_clustering_test.dart`

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:glow_client/utils/map_clustering.dart';

void main() {
  test('dos pines a menos de 40 px se agrupan', () {
    final pines = <PinPunto>[
      PinPunto(id: 'a', posicion: const LatLng(4.6500, -74.0500), destacado: false),
      PinPunto(id: 'b', posicion: const LatLng(4.6501, -74.0501), destacado: false),
    ];
    final grupos = agruparPines(pines, zoom: 14, tamanoPantalla: const Size(360, 640));
    expect(grupos.length, 1);
    expect(grupos.first.ids, {'a', 'b'});
  });

  test('a mucho zoom los mismos pines se separan', () {
    final pines = <PinPunto>[
      PinPunto(id: 'a', posicion: const LatLng(4.6500, -74.0500), destacado: false),
      PinPunto(id: 'b', posicion: const LatLng(4.6501, -74.0501), destacado: false),
    ];
    final grupos = agruparPines(pines, zoom: 18, tamanoPantalla: const Size(360, 640));
    expect(grupos.length, 2);
  });

  test('un grupo de uno conserva su pin', () {
    final grupos = agruparPines(
      [PinPunto(id: 'a', posicion: const LatLng(4.65, -74.05), destacado: true)],
      zoom: 14,
      tamanoPantalla: const Size(360, 640),
    );
    expect(grupos.single.ids, {'a'});
    expect(grupos.single.destacado, isTrue);
  });
}
```

Ejecutar:

```bash
cd apps/glow_client && flutter test test/map_clustering_test.dart
```

Esperado: **falla** con `Error: Couldn't resolve the package 'glow_client' ... map_clustering.dart` (el archivo no existe).

### T2 — Implementar el agrupado

Archivo nuevo: `apps/glow_client/lib/utils/map_clustering.dart`

```dart
import 'dart:math' as math;
import 'dart:ui' show Size;

import 'package:latlong2/latlong.dart';

/// Pin listo para pintar. `destacado` = merece pin grande con dato.
class PinPunto {
  final String id;
  final LatLng posicion;
  final bool destacado;

  const PinPunto({required this.id, required this.posicion, required this.destacado});
}

/// Grupo de pines que se pintan como uno solo.
class GrupoPines {
  final Set<String> ids;
  final LatLng centro;
  final bool destacado;

  const GrupoPines({required this.ids, required this.centro, required this.destacado});
}

/// Distancia en píxeles entre dos coordenadas a un zoom dado (Web Mercator).
/// Es la unidad que importa: el agrupado depende de lo que se ve en pantalla,
/// no de los metros reales.
double pixelesEntre(LatLng a, LatLng b, double zoom) {
  final escala = 256.0 * math.pow(2, zoom);

  double x(double lon) => (lon + 180.0) / 360.0 * escala;
  double y(double lat) {
    final rad = lat * math.pi / 180.0;
    return (1.0 - math.log(math.tan(rad) + 1.0 / math.cos(rad)) / math.pi) / 2.0 * escala;
  }

  final dx = x(a.longitude) - x(b.longitude);
  final dy = y(a.latitude) - y(b.latitude);
  return math.sqrt(dx * dx + dy * dy);
}

/// Agrupa por proximidad en píxeles (<40 px se consideran el mismo punto).
/// Conserva la marca `destacado` si alguno del grupo lo era.
List<GrupoPines> agruparPines(
  List<PinPunto> pines, {
  required double zoom,
  required Size tamanoPantalla,
  double umbralPx = 40,
}) {
  final grupos = <GrupoPines>[];
  for (final pin in pines) {
    GrupoPines? destino;
    for (final g in grupos) {
      if (pixelesEntre(g.centro, pin.posicion, zoom) < umbralPx) {
        destino = g;
        break;
      }
    }
    if (destino == null) {
      grupos.add(GrupoPines(
        ids: {pin.id},
        centro: pin.posicion,
        destacado: pin.destacado,
      ));
    } else {
      final ids = {...destino.ids, pin.id};
      final centro = LatLng(
        (destino.centro.latitude * destino.ids.length + pin.posicion.latitude) / ids.length,
        (destino.centro.longitude * destino.ids.length + pin.posicion.longitude) / ids.length,
      );
      grupos[grupos.indexOf(destino)] = GrupoPines(
        ids: ids,
        centro: centro,
        destacado: destino.destacado || pin.destacado,
      );
    }
  }
  return grupos;
}
```

Ejecutar:

```bash
cd apps/glow_client && dart analyze lib/utils/map_clustering.dart
cd apps/glow_client && flutter test test/map_clustering_test.dart
```

Esperado: `No issues found!` y `All tests passed!` (3 tests).

Commit: `feat(home): agrupado de pines por proximidad`.

### T3 — Orden de resultados: test primero

Archivo nuevo: `apps/glow_client/test/home_ranking_test.dart`

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';
import 'package:glow_client/utils/home_ranking.dart';

ProviderModel prov(String id, int metros, double nota, int resenas) => ProviderModel(
      id: id,
      fullName: id,
      // rellenar el resto de campos requeridos del modelo real
      distanceMeters: metros,
      ratingAvg: nota,
      ratingCount: resenas,
    );

void main() {
  test('a igualdad de zona gana la mejor nota', () {
    final lista = ordenarPorCercaniaYNota([
      prov('a', 900, 3.9, 12),
      prov('b', 1200, 4.9, 80),
    ]);
    expect(lista.first.id, 'b');
  });

  test('una diferencia grande de distancia manda', () {
    final lista = ordenarPorCercaniaYNota([
      prov('a', 300, 4.2, 20),
      prov('b', 4800, 4.9, 80),
    ]);
    expect(lista.first.id, 'a');
  });

  test('sin reseñas no se corona al primero', () {
    final lista = ordenarPorCercaniaYNota([
      prov('nuevo', 400, 5.0, 0),
      prov('probado', 900, 4.7, 60),
    ]);
    expect(lista.first.id, 'probado');
  });
}
```

Ejecutar → falla (no existe `home_ranking.dart`).

### T4 — Implementar el orden

Archivo nuevo: `apps/glow_client/lib/utils/home_ranking.dart`

```dart
import 'package:glow_core/glow_core.dart';

/// Agrupa la distancia en franjas de 1 km y ordena por franja y, dentro de la
/// franja, por nota ponderada (la nota sin reseñas no cuenta como perfecta).
///
/// Regla documentada: un prestador a 4,8 km no le gana a uno a 300 m solo por
/// tener 4.9, pero dentro de la misma franja sí manda la calidad.
List<ProviderModel> ordenarPorCercaniaYNota(List<ProviderModel> proveedores) {
  final copia = [...proveedores];
  copia.sort((a, b) {
    final franjaA = a.distanceMeters ~/ 1000;
    final franjaB = b.distanceMeters ~/ 1000;
    if (franjaA != franjaB) return franjaA.compareTo(franjaB);
    return _notaPonderada(b).compareTo(_notaPonderada(a));
  });
  return copia;
}

/// Media bayesiana: sin reseñas arranca en 4.0, no en 5.
double _notaPonderada(ProviderModel p) {
  const previa = 4.0;
  const peso = 5;
  final n = p.ratingCount;
  return ((p.ratingAvg * n) + (previa * peso)) / (n + peso);
}
```

Ejecutar `flutter test test/home_ranking_test.dart` → 3 passed. Commit.

### T5 — Radio en el cliente

`packages/glow_core/lib/src/services/api_service.dart:439` — añadir parámetro:

```dart
  static Future<List<ProviderModel>> fetchProvidersSecured(
      {double? latitude, double? longitude, int? radius}) async {
    await ensureBaseUrl();
    String url = '$_baseUrl$_apiPath/providers';
    if (latitude != null && longitude != null) {
      url += '?lat=$latitude&lon=$longitude';
      if (radius != null) url += '&radius=$radius';
    }
```

Verificar que el test de cabeceras sigue verde (exige `headers:` en toda llamada `http.*`):

```bash
cd packages/glow_core && flutter test test/api_service_headers_test.dart
```

Esperado: `All tests passed!`

### T6 — Bandeja de resultados

Archivo nuevo: `apps/glow_client/lib/widgets/home_results_sheet.dart`. Esqueleto **completo** a implementar:

```dart
import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

/// Estados de la bandeja. Se emiten para instrumentar el embudo.
enum PosicionBandeja { peek, media, completa }

class HomeResultsSheet extends StatefulWidget {
  final List<ProviderModel> proveedores;
  final void Function(ProviderModel) onSelect;
  final void Function(PosicionBandeja) onPosicion;
  final Widget Function(ProviderModel) construirTarjeta;
  final String? mensajeVacio;
  final VoidCallback? onAmpliarRadio;
  final VoidCallback? onAbrirMapa;

  const HomeResultsSheet({
    super.key,
    required this.proveedores,
    required this.onSelect,
    required this.onPosicion,
    required this.construirTarjeta,
    this.mensajeVacio,
    this.onAmpliarRadio,
    this.onAbrirMapa,
  });

  @override
  State<HomeResultsSheet> createState() => _HomeResultsSheetState();
}

class _HomeResultsSheetState extends State<HomeResultsSheet> {
  final _controller = DraggableScrollableController();

  @override
  void initState() {
    super.initState();
    _controller.addListener(() {
      final t = _controller.size;
      widget.onPosicion(t < 0.25
          ? PosicionBandeja.peek
          : t < 0.6
              ? PosicionBandeja.media
              : PosicionBandeja.completa);
    });
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      controller: _controller,
      initialChildSize: 0.18,   // peek: una tarjeta
      minChildSize: 0.18,
      maxChildSize: 0.90,
      snap: true,
      snapSizes: const [0.18, 0.45, 0.90],
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            boxShadow: [BoxShadow(color: Color(0x14000000), blurRadius: 12, offset: Offset(0, -4))],
          ),
          child: Column(
            children: [
              // Handle de 44 px: zona del pulgar y objetivo táctil correcto.
              SizedBox(
                height: 44,
                child: Center(
                  child: Container(width: 44, height: 4,
                    decoration: BoxDecoration(color: const Color(0xFFE0D8CE), borderRadius: BorderRadius.circular(2))),
                ),
              ),
              Expanded(
                child: widget.proveedores.isEmpty
                    ? _vacio(context)
                    : ListView.separated(
                        controller: scrollController,
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                        itemCount: widget.proveedores.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (context, i) {
                          final p = widget.proveedores[i];
                          return GestureDetector(
                            onTap: () => widget.onSelect(p),
                            child: widget.construirTarjeta(p),
                          );
                        },
                      ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _vacio(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.explore_off_outlined, size: 40, color: Color(0xFFC5A052)),
            const SizedBox(height: 12),
            Text(widget.mensajeVacio ?? 'No hay prestadores en esta zona.',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 13, color: Color(0xFF8A7F72))),
            if (widget.onAmpliarRadio != null) ...[
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: widget.onAmpliarRadio,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFC5A052),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
                ),
                child: const Text('Ampliar la búsqueda'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
```

Test de widget: `apps/glow_client/test/home_results_sheet_test.dart`

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_client/widgets/home_results_sheet.dart';

void main() {
  testWidgets('sin resultados ofrece ampliar la búsqueda', (tester) async {
    var ampliado = false;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: HomeResultsSheet(
          proveedores: const [],
          onSelect: (_) {},
          onPosicion: (_) {},
          construirTarjeta: (_) => const SizedBox(height: 90),
          mensajeVacio: 'No hay nadie a 5 km',
          onAmpliarRadio: () => ampliado = true,
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(HomeResultsSheet), const Offset(0, -300));
    await tester.pumpAndSettle();
    expect(find.text('No hay nadie a 5 km'), findsOneWidget);
    await tester.tap(find.text('Ampliar la búsqueda'));
    expect(ampliado, isTrue);
  });
}
```

Ejecutar:

```bash
cd apps/glow_client && flutter test test/home_results_sheet_test.dart
```

Esperado: 1 test verde.

### T7 — Integrar en el home

En `providers_screen.dart`, dentro del `Stack` del `body` (después del `MarkerLayer`, línea ~1.930):

```dart
              // Bandeja de resultados: lista visible, no un panel oculto.
              if (!_soloLista)
                HomeResultsSheet(
                  proveedores: _resultadosOrdenados,
                  onSelect: (p) => _enfocarPrestador(p),
                  onPosicion: _registrarPosicionBandeja,
                  construirTarjeta: (p) => _buildProviderCard(p),
                ),
```

Y el estado nuevo en `_ProvidersScreenState` (junto a `_allProviders`, línea 23):

```dart
  List<ProviderModel> _resultadosOrdenados = [];
  int _radioMetros = 5000;
  bool _soloLista = false;
```

`_enfocarPrestador(ProviderModel p)`: mueve el mapa a `LatLng(p.latitude, p.longitude)` con `_animatedMapMove(..., 16)` y abre el detalle que ya usa la tarjeta.

**No tocar** `_tutorialStep` ni `_animatedMapMove`: el recorrido del GlowGuide depende de ellos.

Verificar integración:

```bash
cd apps/glow_client && dart analyze lib/screens/providers_screen.dart
```

Esperado: `0` líneas con `error -`:

```bash
dart analyze lib/screens/providers_screen.dart 2>&1 | grep -cE "^\s+error - "   # debe imprimir 0
```

### T8 — Pines por niveles

Donde hoy se construye la lista de `Marker` (~línea 1.915), sustituir por:

```dart
  final destacados = _resultadosOrdenados.take(5).map((p) => p.id).toSet();
  final pines = _resultadosOrdenados
      .map((p) => PinPunto(
            id: p.id,
            posicion: LatLng(p.latitude, p.longitude),
            destacado: destacados.contains(p.id),
          ))
      .toList();
  final grupos = agruparPines(pines, zoom: _mapController.camera.zoom,
      tamanoPantalla: MediaQuery.sizeOf(context));
```

Render:

- `grupos.length == 1 && ids.length == 1` → pin normal (mismo widget de hoy).
- `ids.length == 1` → pin grande si `destacado`, punto de 12 px si no.
- `ids.length > 1` → círculo con el número centrado en `centro`.

Verificación visual y por rastro (no hay test de mapa):

```bash
cd apps/glow_client && grep -c "PinPunto(" lib/screens/providers_screen.dart   # >= 1
```

### T9 — «Ver como lista» (modo sin mapa)

En la `AppBar` o en el pill del buscador, un `IconButton` con tooltip `Ver como lista` que alterna `_soloLista`. Cuando está activo:

- el `Stack` pinta la bandeja ocupando todo el alto (`initialChildSize` 0.9) y no pinta `FlutterMap`;
- se envía el evento `MAP_MODE_OFF` (T11).

Verificación:

```bash
cd apps/glow_client && grep -c "_soloLista" lib/screens/providers_screen.dart   # >= 3
```

### T10 — Radio adaptativo

En `_loadProviders()` (línea ~60), al recibir lista vacía:

```dart
    if (_resultadosOrdenados.isEmpty && _radioMetros < 10000) {
      setState(() => _radioMetros = _radioMetros * 2);   // 5 km -> 10 km
      return _loadProviders();                            // un solo reintento
    }
```

Y el mensaje de la bandeja cuando sigue vacío a 10 km: `«Los más cercanos están a ${(_allProviders.first.distanceMeters / 1000).toStringAsFixed(1)} km»`.

Verificación: prueba manual con coordenadas de un municipio sin prestadores (p. ej. `lat=4.34&lon=-74.36`, Fusagasugá) → la bandeja muestra el mensaje, no una pantalla vacía.

### T11 — Eventos del embudo

En los tres puntos de interacción, con el servicio ya exportado (`glow_core/services.dart`):

```dart
AnalyticsService().logEvent(eventType: 'HOME_SHEET_EXPANDED', screenName: '/home', metadata: {'posicion': posicion.name});
AnalyticsService().logEvent(eventType: 'PROVIDER_CARD_TAP', screenName: '/home', elementId: p.id, metadata: {'metros': p.distanceMeters});
AnalyticsService().logEvent(eventType: 'MAP_MODE_OFF', screenName: '/home');
```

Verificación:

```bash
cd apps/glow_client && grep -c "HOME_SHEET_EXPANDED\|PROVIDER_CARD_TAP\|MAP_MODE_OFF" lib/screens/providers_screen.dart   # >= 3
```

### T12 — Cierre: análisis, tests y bundle

```bash
cd apps/glow_client && dart analyze lib 2>&1 | grep -cE "^\s+error - "   # 0
cd apps/glow_client && flutter test                                      # todos verdes
cd ~/glowapp-firebase && git push origin HEAD:main HEAD:staging
sleep 300 && curl -s https://glowapp-client.web.app/main.dart.js -o /tmp/b.js && grep -c "Ampliar la b" /tmp/b.js   # 1
```

## Tests / validation

| Test | Tipo | Qué fija |
|---|---|---|
| `test/map_clustering_test.dart` | unitario | agrupa < 40 px, separa a zoom alto, conserva destacado |
| `test/home_ranking_test.dart` | unitario | franja de 1 km, nota ponderada, sin reseñas no corona |
| `test/home_results_sheet_test.dart` | widget | vacío ofrece ampliar; el botón dispara el callback |
| `test/api_service_headers_test.dart` | existente | toda llamada `http.*` lleva cabeceras |

Ciclo por tarea: test rojo → implementación mínima → test verde → commit. Nada de escribir la implementación antes del test en T1, T3 y T6.

Validación manual obligatoria antes de cerrar (no automatizable):

1. Home en móvil: bandeja en peek, arrastrar a media y completa; la lista se desplaza sin pelearse con el gesto.
2. Tocar un pin destacado → el mapa lo centra y la bandeja sube a media con esa tarjeta.
3. Zona sin prestadores → mensaje + botón que amplía y vuelve a buscar.
4. «Ver como lista» → sin mapa, lista a pantalla completa, la app sigue navegable.
5. El tutorial del GlowGuide sigue funcionando (18 referencias a `_tutorialStep`).

## Risks, tradeoffs, and open questions

**Riesgos**

- **`providers_screen.dart` tiene 2.839 líneas y un tutorial enganchado.** Cualquier reordenamiento del `Stack` puede tapar el overlay del guide. Mitigación: la bandeja se añade como último hijo del `Stack` y el tutorial se verifica a mano.
- **Clustering propio vs paquete.** Se elige propio por no tocar versiones de `flutter_map`. Coste: ~60 líneas y un test que hay que mantener.
- **Rendimiento en gama baja.** 60 pines máximo por vista; si con 200 prestadores el mapa se arrastra, bajar a 40 y dejar el resto solo en la lista.
- **El mapa consume datos.** El modo lista lo mitiga, pero no hay caché de tiles todavía: sesiones largas seguirán gastando megas. Fuera de alcance.

**Decisiones tomadas (no reabrir sin motivo)**

- Sin panel lateral deslizable en móvil: choca con el gesto atrás de Android/iOS.
- La lista va visible; el panel izquierdo queda para tablet/escritorio (no en esta entrega).
- Nunca devolver cero resultados: radio 5 → 10 km → «los más cercanos».

**Resuelto (2026-11-04): «cerca y disponible hoy» es el orden oficial**

- `backend/src/utils/disponibilidad.js` calcula el primer hueco libre de hoy (rejilla de 30 min, horario del prestador, colisiones) **en hora de Bogotá** con desplazamiento fijo de -5 h. 7 nodetests.
- `GET /api/providers` devuelve `next_slot_today` y `available_today` y ordena: disponible hoy → franja de 1 km → nota ponderada.
- `ProviderModel` expone ambos campos; `home_ranking.dart` replica la regla en el cliente (5 tests).
- **T4 queda implementado**; la bandeja (T6-T8) debe mostrar el hueco como chip: `Hoy 09:00`.
- **Salones.** Cuando lleguen: pin propio y chip de filtro. No se implementa aquí.
- **Radio inicial.** Se fija en 5 km; con datos reales de densidad quizá convenga 3 km en Bogotá y 10 km fuera.
- **Escritorio.** El panel izquierdo de 380 px queda pendiente como segunda entrega del mismo componente.
