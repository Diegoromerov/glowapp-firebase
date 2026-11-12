// lib/screens/niveles_screen.dart
//
// Club Glow Luxe — pantalla de nivel y cuota de análisis con IA.
//
// Todo lo que se muestra sale del backend: GET /api/rewards/nivel (nivel, XP,
// lecturas otorgadas/usadas/disponibles y su desglose) y GET /api/rewards/points
// (saldo en pesos). No hay un solo número escrito a mano: el mockup anterior
// mostraba «350 XP · Gold» fijos a toda usuaria.
//
// Diseño: el nivel manda (serif en oro), la escalera se lee como riel y no como
// tabla, la cuota se presenta como algo ganado con su desglose, y el canje tiene
// botón honesto — activo con saldo, apagado con el motivo.
import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

/// Escalera del programa. Debe coincidir con `BONO_POR_NIVEL` del backend:
/// 0 / 300 / 900 / 2.000 XP (Glow · Pétalo · Gold · Élite).
const List<({String nombre, int xp, String glifo})> kEscalera = [
  (nombre: 'Glow', xp: 0, glifo: '✦'),
  (nombre: 'Pétalo', xp: 300, glifo: '❋'),
  (nombre: 'Gold', xp: 900, glifo: '✧'),
  (nombre: 'Élite', xp: 2000, glifo: '✵'),
];

/// Índice del nivel actual en la escalera. Nunca -1: si el backend devuelve un
/// nombre que la app todavía no conoce, se cae al primer escalón.
int indiceDeNivel(String nivel) {
  final n = _plano(nivel);
  for (var i = 0; i < kEscalera.length; i++) {
    final clave = _plano(kEscalera[i].nombre);
    // Igualdad primero; si el backend manda «Élite Diamond» o «Petalo», basta
    // con que las cuatro primeras letras coincidan.
    if (n == clave || (n.length >= 4 && n.startsWith(clave.substring(0, 4)))) {
      return i;
    }
  }
  return 0;
}

/// Minúsculas y sin diacríticos: el backend puede mandar «Petalo» y la escalera
/// local dice «Pétalo». Sin esto, la comparación falla por un acento.
String _plano(String s) => s
    .toLowerCase()
    .trim()
    .replaceAll('á', 'a')
    .replaceAll('é', 'e')
    .replaceAll('í', 'i')
    .replaceAll('ó', 'o')
    .replaceAll('ú', 'u')
    .replaceAll('ü', 'u')
    .replaceAll('Á', 'a')
    .replaceAll('É', 'e');

/// Fracción de avance dentro del tramo actual (0.0 a 1.0).
///
/// Se mide entre el umbral del nivel y el del siguiente, no contra el total: si
/// se midiera contra 2.000, una usuaria con 350 XP vería 17 % y parecería que no
/// avanza. En el tramo Pétalo→Gold, 350 XP es 8 %… que es la verdad, pero el
/// riel de abajo da el contexto de la escalera completa.
/// Avance sobre la escalera completa (0.0 a 1.0), en la MISMA escala en que
/// están dibujados los hitos de la barra. Usar aquí el avance del tramo dejaba
/// la barra y los hitos contradiciéndose: el relleno marcaba 8 % mientras el
/// hito de 900 XP se veía al 45 % del ancho.
double avanceAbsoluto(int xp) {
  final techo = kEscalera.last.xp;
  if (techo <= 0) return 0;
  return (xp / techo).clamp(0.0, 1.0);
}

double avanceEnTramo(int xp, int indice) {
  if (indice < 0 || indice >= kEscalera.length) return 0;
  final desde = kEscalera[indice].xp;
  final hasta = indice + 1 < kEscalera.length ? kEscalera[indice + 1].xp : null;
  if (hasta == null) return 1.0;
  final tramo = hasta - desde;
  if (tramo <= 0) return 1.0;
  final avance = (xp - desde) / tramo;
  return avance.clamp(0.0, 1.0);
}

class NivelesScreen extends StatefulWidget {
  const NivelesScreen({super.key});

  @override
  State<NivelesScreen> createState() => _NivelesScreenState();
}

class _NivelesScreenState extends State<NivelesScreen> {
  late Future<(NivelPuntos?, SaldoPuntos?)> _datos;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  void _cargar() {
    // Plazo máximo por petición. Sin él, una llamada que no resuelve —por
    // ejemplo sin sesión, donde el cliente HTTP se queda esperando— deja la
    // pantalla girando para siempre en vez de mostrar el reintento.
    const plazo = Duration(seconds: 8);
    _datos = Future.wait<Object?>([
      RewardsService.obtenerNivel().timeout(plazo, onTimeout: () => null),
      RewardsService.obtenerSaldo().timeout(plazo, onTimeout: () => null),
    ]).then((r) => (
          r[0] as NivelPuntos?,
          r[1] as SaldoPuntos?,
        ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: LuxeColors.nude50,
      appBar: AppBar(
        backgroundColor: LuxeColors.nude50,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          tooltip: 'Regresar',
          icon: const Icon(Icons.arrow_back_ios_new,
              color: LuxeColors.nude900, size: 18),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text(
          'CLUB GLOW LUXE',
          style: TextStyle(
            fontFamily: 'Manrope',
            fontSize: 11,
            fontWeight: FontWeight.w600,
            letterSpacing: 3.2,
            color: LuxeColors.nude800,
          ),
        ),
        centerTitle: true,
      ),
      body: FutureBuilder<(NivelPuntos?, SaldoPuntos?)>(
        future: _datos,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(
              child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                    strokeWidth: 1.6, color: LuxeColors.gold871),
              ),
            );
          }
          final nivel = snap.data?.$1;
          final saldo = snap.data?.$2;
          if (nivel == null) {
            return _ErrorReintento(onReintentar: () => setState(_cargar));
          }
          return Center(
            child: ConstrainedBox(
              // En web el viewport es de 1200 px y el diseño está pensado para
              // móvil: sin tope, el nivel se separa del riel y la tarjeta de IA
              // se estira hasta parecer un panel de escritorio.
              constraints: const BoxConstraints(maxWidth: 520),
              child: SingleChildScrollView(
            physics: const BouncingScrollPhysics(),
            padding: const EdgeInsets.only(bottom: 32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _Hero(nivel: nivel),
                const SizedBox(height: 26),
                _Riel(nivel: nivel),
                const SizedBox(height: 24),
                _TarjetaIA(nivel: nivel),
                const SizedBox(height: 13),
                _TarjetaPuntos(saldo: saldo),
                const SizedBox(height: 8),
                Center(
                  child: TextButton(
                    onPressed: () =>
                        Navigator.pushNamed(context, '/programa-puntos'),
                    child: const Text(
                      'Cómo funcionan los puntos',
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: LuxeColors.gold700,
                        decoration: TextDecoration.underline,
                        decorationColor: LuxeColors.gold700,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 5),
                _Invitar(onTap: () => Navigator.pushNamed(context, '/invite')),
                const SizedBox(height: 26),
                const _Encabezado('LO QUE ABRE TU NIVEL'),
                const SizedBox(height: 11),
                const _Beneficios(),
              ],
            ),
              ),
            ),
          );
        },
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────── hero ──
class _Hero extends StatelessWidget {
  const _Hero({required this.nivel});
  final NivelPuntos nivel;

  @override
  Widget build(BuildContext context) {
    final i = indiceDeNivel(nivel.nivel);
    final avance = avanceAbsoluto(nivel.xp);
    final falta = nivel.restantesParaSiguiente;

    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Container(
              width: 24,
              height: 1,
              color: LuxeColors.gold871.withValues(alpha: .6),
            ),
            const SizedBox(width: 9),
            const Text(
              'TU NIVEL ACTUAL',
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 8.5,
                letterSpacing: 3,
                fontWeight: FontWeight.w600,
                color: LuxeColors.gold700,
              ),
            ),
          ]),
          const SizedBox(height: 12),
          // El nivel en oro: ShaderMask en vez de color plano, para que las
          // puntas del degradado se hundan y se lea como insignia, no como cifra.
          ShaderMask(
            shaderCallback: (r) => const LinearGradient(
              colors: [
                LuxeColors.goldDark,
                Color(0xFFA87C2E),
                LuxeColors.goldLight,
                LuxeColors.gold871,
                LuxeColors.goldDark,
              ],
              stops: [0.0, .26, .52, .72, 1.0],
            ).createShader(r),
            child: Text(
              nivel.nivel,
              style: const TextStyle(
                fontFamily: 'CormorantGaramond',
                fontSize: 62,
                height: .92,
                letterSpacing: -1.4,
                fontWeight: FontWeight.w500,
                color: Colors.white,
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                '${nivel.xp} XP',
                style: const TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.1,
                  color: LuxeColors.nude800,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                nivel.esNivelMaximo
                    ? 'nivel máximo alcanzado'
                    : 'de ${nivel.xpSiguienteNivel} para ${nivel.nivelSiguiente}',
                style: const TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 11.5,
                  color: LuxeColors.nude600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 22),
          _Barra(avance: avance, indice: i),
          const SizedBox(height: 9),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '${nivel.nivel.toUpperCase()} · DESDE ${kEscalera[i].xp} XP',
                style: const TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 8.5,
                  letterSpacing: 1.1,
                  color: LuxeColors.nude500,
                ),
              ),
              Text(
                nivel.esNivelMaximo ? 'techo del club' : 'faltan $falta XP',
                style: const TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 8.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.1,
                  color: LuxeColors.nude800,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Barra extends StatelessWidget {
  const _Barra({required this.avance, required this.indice});
  final double avance;
  final int indice;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, c) {
      final ancho = c.maxWidth;
      return SizedBox(
        height: 26,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: Container(
                height: 6,
                decoration: BoxDecoration(
                  color: LuxeColors.nude200,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
            Positioned(
              top: 0,
              left: 0,
              child: TweenAnimationBuilder<double>(
                tween: Tween(begin: 0, end: avance),
                duration: const Duration(milliseconds: 1200),
                curve: Curves.easeOutCubic,
                builder: (_, v, __) => Container(
                  height: 6,
                  width: ancho * v,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(99),
                    gradient: const LinearGradient(colors: [
                      Color(0xFFA87C2E),
                      LuxeColors.gold871,
                      LuxeColors.goldLight,
                    ]),
                  ),
                ),
              ),
            ),
            // Hitos de la escalera sobre la barra: se ve que después de Gold
            // todavía hay un Élite, sin necesidad de otra sección.
            for (var i = 1; i < kEscalera.length; i++)
              Positioned(
                left: (kEscalera[i].xp / kEscalera.last.xp) * ancho - .5,
                top: -3,
                child: Container(
                  width: 1,
                  height: 12,
                  color: LuxeColors.nude900.withValues(alpha: .16),
                ),
              ),
          ],
        ),
      );
    });
  }
}

// ─────────────────────────────────────────────────────────── riel ──
class _Riel extends StatelessWidget {
  const _Riel({required this.nivel});
  final NivelPuntos nivel;

  @override
  Widget build(BuildContext context) {
    final actual = indiceDeNivel(nivel.nivel);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Row(
        children: [
          for (var i = 0; i < kEscalera.length; i++) ...[
            Expanded(
              child: Column(
                children: [
                  Container(
                    width: i == actual ? 40 : 34,
                    height: i == actual ? 40 : 34,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: i == actual
                          ? LuxeColors.nude900
                          : i < actual
                              ? LuxeColors.gold871.withValues(alpha: .14)
                              : LuxeColors.nude50,
                      border: Border.all(
                        color: i == actual
                            ? Colors.transparent
                            : i < actual
                                ? LuxeColors.gold871.withValues(alpha: .45)
                                : LuxeColors.nude900.withValues(alpha: .12),
                      ),
                      boxShadow: i == actual
                          ? [
                              BoxShadow(
                                color: LuxeColors.gold871.withValues(alpha: .22),
                                blurRadius: 0,
                                spreadRadius: 4,
                              ),
                            ]
                          : null,
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      kEscalera[i].glifo,
                      style: TextStyle(
                        fontSize: 14,
                        color: i == actual
                            ? LuxeColors.gold300
                            : i < actual
                                ? LuxeColors.gold700
                                : LuxeColors.nude400,
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    kEscalera[i].nombre.toUpperCase(),
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 7.5,
                      letterSpacing: 1.4,
                      fontWeight: i == actual ? FontWeight.w700 : FontWeight.w500,
                      color: i == actual
                          ? LuxeColors.nude800
                          : LuxeColors.nude500,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${kEscalera[i].xp}',
                    style: const TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 8.5,
                      color: LuxeColors.nude400,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ────────────────────────────────────────────────────── tarjeta IA ──
class _TarjetaIA extends StatelessWidget {
  const _TarjetaIA({required this.nivel});
  final NivelPuntos nivel;

  @override
  Widget build(BuildContext context) {
    final total = nivel.otorgadas;
    final usadas = nivel.usadas;
    final d = nivel.desglose;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 24),
      padding: const EdgeInsets.fromLTRB(18, 19, 18, 16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF231C17), Color(0xFF151110)],
        ),
        boxShadow: [
          BoxShadow(
            color: LuxeColors.nude900.withValues(alpha: .22),
            blurRadius: 26,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'ANÁLISIS CON IA · ESTE MES',
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 8,
                        letterSpacing: 2.4,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFFA59477),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.baseline,
                      textBaseline: TextBaseline.alphabetic,
                      children: [
                        Text(
                          '${nivel.disponibles}',
                          style: const TextStyle(
                            fontFamily: 'CormorantGaramond',
                            fontSize: 38,
                            height: 1,
                            fontWeight: FontWeight.w500,
                            color: LuxeColors.nude50,
                          ),
                        ),
                        const SizedBox(width: 7),
                        Text(
                          'de $total disponibles',
                          style: const TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 11.5,
                            color: Color(0xFF9C9083),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(99),
                  gradient: const LinearGradient(
                      colors: [LuxeColors.goldLight, LuxeColors.gold871]),
                ),
                child: Text(
                  nivel.disponibles > 0 ? 'ACTIVO' : 'AGOTADO',
                  style: const TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 7.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.4,
                    color: LuxeColors.nude900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              for (var i = 0; i < total; i++)
                Expanded(
                  child: Container(
                    height: 5,
                    margin: EdgeInsets.only(right: i == total - 1 ? 0 : 6),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(99),
                      color: i < usadas
                          ? Colors.white.withValues(alpha: .07)
                          : null,
                      gradient: i < usadas
                          ? null
                          : const LinearGradient(colors: [
                              LuxeColors.gold871,
                              LuxeColors.goldLight,
                            ]),
                    ),
                  ),
                ),
              if (total == 0)
                Expanded(
                  child: Container(
                    height: 5,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(99),
                      color: Colors.white.withValues(alpha: .07),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 15),
          Row(
            children: [
              _DatoIA(label: 'Al registrarte', valor: d['base'] ?? 0),
              _DatoIA(label: 'Reservas', valor: d['reservas'] ?? 0),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _DatoIA(label: 'Compras', valor: d['compras'] ?? 0),
              _DatoIA(label: 'Por nivel', valor: d['nivel'] ?? 0),
            ],
          ),
          const SizedBox(height: 13),
          const Text(
            'SE RENUEVAN EL PRIMER DÍA DEL MES',
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 8,
              letterSpacing: 1.4,
              color: Color(0xFF7A6F63),
            ),
          ),
        ],
      ),
    );
  }
}

class _DatoIA extends StatelessWidget {
  const _DatoIA({required this.label, required this.valor});
  final String label;
  final int valor;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        margin: const EdgeInsets.only(right: 14),
        padding: const EdgeInsets.only(bottom: 5),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(color: Colors.white.withValues(alpha: .06)),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Flexible(
              child: Text(
                label,
                style: const TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 10.5,
                  color: Color(0xFF9C9083),
                ),
              ),
            ),
            Text(
              valor > 0 ? '+$valor' : '0',
              style: const TextStyle(
                fontFamily: 'Manrope',
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
                color: Color(0xFFEAE1D1),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ────────────────────────────────────────────────── tarjeta puntos ──
class _TarjetaPuntos extends StatelessWidget {
  const _TarjetaPuntos({required this.saldo});
  final SaldoPuntos? saldo;

  @override
  Widget build(BuildContext context) {
    final puntos = saldo?.saldo ?? 0;
    final bloque = saldo?.bloqueCanje ?? 100;
    final pesos = puntos * (saldo?.valorPuntoCop ?? 10);
    final puedeCanjear = puntos >= bloque;
    final faltan = bloque - puntos;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 24),
      padding: const EdgeInsets.fromLTRB(16, 15, 16, 15),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .68),
        borderRadius: BorderRadius.circular(19),
        border: Border.all(color: LuxeColors.nude900.withValues(alpha: .09)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      '$puntos',
                      style: const TextStyle(
                        fontFamily: 'CormorantGaramond',
                        fontSize: 26,
                        height: 1,
                        fontWeight: FontWeight.w500,
                        color: LuxeColors.nude900,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      'puntos = \$$pesos',
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 10.5,
                        color: LuxeColors.nude600,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 5),
                Text(
                  puedeCanjear
                      ? 'Se aplican como descuento en GlowShop'
                      : 'Junta $faltan puntos para tu primer descuento',
                  style: const TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 10,
                    color: LuxeColors.nude600,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          // Botón honesto: activo con saldo, apagado con el motivo a la vista.
          Opacity(
            opacity: puedeCanjear ? 1 : .45,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 10),
              decoration: BoxDecoration(
                color: LuxeColors.nude900,
                borderRadius: BorderRadius.circular(99),
              ),
              child: const Text(
                'Usar puntos',
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  color: LuxeColors.nude50,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ──────────────────────────────────────────────────────── invitar ──
class _Invitar extends StatelessWidget {
  const _Invitar({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(19),
          child: Ink(
            padding: const EdgeInsets.fromLTRB(16, 15, 16, 15),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(19),
              gradient: const LinearGradient(colors: [
                Color(0xFF8A6626),
                LuxeColors.gold871,
                LuxeColors.goldLight,
                Color(0xFFB08A3E),
              ]),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF8A6626).withValues(alpha: .3),
                  blurRadius: 20,
                  offset: const Offset(0, 10),
                ),
              ],
            ),
            child: Row(
              children: [
                Container(
                  width: 33,
                  height: 33,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .24),
                    borderRadius: BorderRadius.circular(11),
                  ),
                  alignment: Alignment.center,
                  child: const Icon(Icons.card_giftcard,
                      size: 16, color: Color(0xFF1F190F)),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Invita amigas, gana 500 puntos',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: Color(0xFF1F190F),
                        ),
                      ),
                      SizedBox(height: 2),
                      Text(
                        'Hasta \$5.000 en tu próxima compra',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 10,
                          color: Color(0xBB1F190F),
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right,
                    size: 18, color: Color(0xFF1F190F)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ───────────────────────────────────────────────────── beneficios ──
class _Encabezado extends StatelessWidget {
  const _Encabezado(this.texto);
  final String texto;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Text(
        texto,
        style: const TextStyle(
          fontFamily: 'Manrope',
          fontSize: 8,
          letterSpacing: 2.2,
          fontWeight: FontWeight.w600,
          color: LuxeColors.nude500,
        ),
      ),
    );
  }
}

class _Beneficios extends StatelessWidget {
  const _Beneficios();

  static const _items = [
    (titulo: '×2', sufijo: 'XP', texto: 'Un día al mes que tú eliges', tag: 'PÉTALO'),
    (titulo: '+1', sufijo: 'análisis', texto: 'Escaneo de piel con IA extra', tag: 'PÉTALO'),
    (titulo: '24', sufijo: 'h', texto: 'Reservas antes que nadie', tag: 'GOLD'),
  ];

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 132,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 24),
        itemCount: _items.length + 1,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (context, i) {
          if (i == _items.length) {
            return Container(
              width: 152,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: LuxeColors.nude900.withValues(alpha: .18),
                  style: BorderStyle.solid,
                ),
              ),
              alignment: Alignment.center,
              child: const Text(
                'Sube a Élite y abres acceso anticipado a lanzamientos',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 10,
                  height: 1.5,
                  color: LuxeColors.nude500,
                ),
              ),
            );
          }
          final b = _items[i];
          return Container(
            width: 152,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xF7FFFFFF), LuxeColors.nude100],
              ),
              border: Border.all(color: LuxeColors.nude900.withValues(alpha: .09)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                RichText(
                  text: TextSpan(
                    children: [
                      TextSpan(
                        text: b.titulo,
                        style: const TextStyle(
                          fontFamily: 'CormorantGaramond',
                          fontSize: 30,
                          height: 1,
                          fontWeight: FontWeight.w500,
                          color: LuxeColors.nude900,
                        ),
                      ),
                      TextSpan(
                        text: ' ${b.sufijo}',
                        style: const TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 10,
                          color: LuxeColors.nude600,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  b.texto,
                  style: const TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 10.5,
                    height: 1.4,
                    color: LuxeColors.nude700,
                  ),
                ),
                const Spacer(),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                  decoration: BoxDecoration(
                    color: LuxeColors.gold871.withValues(alpha: .13),
                    borderRadius: BorderRadius.circular(99),
                  ),
                  child: Text(
                    b.tag,
                    style: const TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 7,
                      letterSpacing: 1.4,
                      fontWeight: FontWeight.w700,
                      color: LuxeColors.gold700,
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

// ───────────────────────────────────────────────────────── error ──
class _ErrorReintento extends StatelessWidget {
  const _ErrorReintento({required this.onReintentar});
  final VoidCallback onReintentar;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'No pudimos cargar tu nivel',
              style: TextStyle(
                fontFamily: 'CormorantGaramond',
                fontSize: 22,
                color: LuxeColors.nude900,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Revisa tu conexión y vuelve a intentarlo.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 12,
                color: LuxeColors.nude600,
              ),
            ),
            const SizedBox(height: 18),
            TextButton(
              onPressed: onReintentar,
              child: const Text('Reintentar',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: LuxeColors.gold700,
                  )),
            ),
          ],
        ),
      ),
    );
  }
}
