// lib/screens/profile/rewards_xp_screen.dart
import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
class RewardsXpScreen extends StatelessWidget {
  const RewardsXpScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: LuxeColors.nude50,
      appBar: AppBar(
        backgroundColor: LuxeColors.nude50,
        elevation: 0,
        leading: IconButton(
          tooltip: 'Regresar',
          icon: const Icon(Icons.arrow_back_ios_new, color: LuxeColors.nude900, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text(
          'CLUB GLOW LUXE & XP',
          style: TextStyle(
            fontFamily: 'Didot',
            fontSize: 15,
            fontWeight: FontWeight.bold,
            color: LuxeColors.nude900,
            letterSpacing: 1.2,
          ),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 680),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(LuxeSpacing.xl),
              child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Programa de referidos: hasta ahora existía en el backend y no
              // tenía entrada en la app.
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => Navigator.pushNamed(context, '/invite'),
                  icon: const Icon(Icons.card_giftcard, size: 18, color: Color(0xFF8A6A2F)),
                  label: const Text(
                    'Invitar amigas · 500 puntos (hasta \$5.000)',
                    style: TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF8A6A2F),
                    ),
                  ),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    side: const BorderSide(color: Color(0xFFD4AF37)),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14)),
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Saldo real del fondo de puntos (migración 142). La tarjeta VIP de
              // abajo sigue siendo decorativa: los puntos de dinero se muestran
              // aquí, separados y con su equivalencia en pesos, para que nadie
              // intente gastar el XP de nivel.
              const _TarjetaPuntosCanjeables(),
              const SizedBox(height: 16),

              // Tarjeta del club con datos REALES (E5).
              //
              // La versión anterior mostraba «350 XP · Nivel Gold · Siguiente:
              // Élite Diamond (500 XP)» como tres `const`: todo el mundo veía lo
              // mismo, tuviera 0 o 3.000 XP. Ahora lee GET /api/rewards/nivel y
              // abre la pantalla completa del club.
              const _TarjetaNivelReal(),

              const SizedBox(height: LuxeSpacing.xxl),

              const Text(
                'BENEFICIOS ACTIVOS Y CUPONES',
                style: TextStyle(
                  fontFamily: 'JetBrainsMono',
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: LuxeColors.nude500,
                  letterSpacing: 1.2,
                ),
              ),
              const SizedBox(height: 12),

              // Los tres beneficios que había eran inventados y dos contradecían
              // el programa: «15 % OFF canjeando XP» (el XP no se canjea, no es
              // dinero) y «diagnóstico ilimitado» (hay una cuota mensual por
              // diseño). Estos son los aprobados, y sí existen.
              _buildBenefitTile(
                icon: Icons.bolt_outlined,
                title: 'XP ×2 un día al mes',
                subtitle: 'Desde el nivel Pétalo: eliges el día',
              ),
              _buildBenefitTile(
                icon: Icons.auto_awesome_outlined,
                title: 'Análisis con IA extra cada mes',
                subtitle: 'Una lectura adicional por nivel, sin costo',
              ),
              _buildBenefitTile(
                icon: Icons.event_available_outlined,
                title: 'Reservas con 24 h de prioridad',
                subtitle: 'Desde Gold: tu agenda antes que el resto',
              ),
            ],
          ),
        ),
      ),
    ),
  ),
);
  }

  static Widget _buildBenefitTile({
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: LuxeColors.nude200),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFFC5A052).withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: const Color(0xFFC5A052), size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontFamily: 'Didot',
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    color: LuxeColors.nude900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontSize: 13,
                    color: LuxeColors.nude600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Saldo del fondo de puntos canjeable, separado del XP de nivel.
///
/// El XP no vale pesos y los puntos sí: mezclarlos en una sola cifra hace que la
/// usuaria intente gastar nivel y se decepcione. El número viene del backend
/// (`GET /api/rewards/points`), que ya excluye lo vencido y lo comprometido.
class _TarjetaPuntosCanjeables extends StatelessWidget {
  const _TarjetaPuntosCanjeables();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<SaldoPuntos?>(
      future: RewardsService.obtenerSaldo(),
      builder: (context, snapshot) {
        final cargando = snapshot.connectionState == ConnectionState.waiting;
        final saldo = snapshot.data;

        return Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE8E0D5)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'PUNTOS PARA DESCUENTOS',
                style: TextStyle(
                  fontFamily: 'JetBrainsMono',
                  fontSize: 9,
                  letterSpacing: 1.2,
                  color: LuxeColors.nude600,
                ),
              ),
              const SizedBox(height: 8),
              if (cargando)
                const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              if (!cargando && saldo == null)
                const Text(
                  'No pudimos leer tu saldo ahora mismo.',
                  style: TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontSize: 13,
                    color: LuxeColors.nude600,
                  ),
                ),
              if (saldo != null) ...[
                Text(
                  '${saldo.saldo} puntos = \$${_miles(saldo.enPesos)}',
                  style: const TextStyle(
                    fontFamily: 'Didot',
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                    color: LuxeColors.nude900,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  saldo.tieneSaldo
                      ? 'Se aplican como descuento en GlowShop, hasta el '
                          '${saldo.topePorcentaje}% del valor de los productos '
                          'en un pedido de \$${_miles(saldo.minimoPedido)} o más.'
                      : 'Junta al menos ${saldo.bloqueCanje} puntos para empezar a usarlos.',
                  style: const TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontSize: 13,
                    height: 1.3,
                    color: LuxeColors.nude600,
                  ),
                ),
                if (saldo.enEspera > 0) ...[
                  const SizedBox(height: 8),
                  Text(
                    '${saldo.enEspera} puntos están en espera de un pedido sin pagar. '
                    'Si no se paga, vuelven solos.',
                    style: const TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontSize: 12,
                      color: LuxeColors.nude600,
                    ),
                  ),
                ],
                const SizedBox(height: 6),
                TextButton(
                  onPressed: () => Navigator.pushNamed(context, '/programa-puntos'),
                  style: TextButton.styleFrom(
                    padding: EdgeInsets.zero,
                    minimumSize: const Size(0, 28),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: const Text(
                    'Cómo funcionan los puntos',
                    style: TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontSize: 12,
                      decoration: TextDecoration.underline,
                      color: Color(0xFF8A6A2F),
                    ),
                  ),
                ),
                if (saldo.porVencer.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Tienes ${saldo.porVencer.first.puntos} puntos que vencen pronto.',
                    style: const TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontSize: 12,
                      color: Color(0xFFAA7C11),
                    ),
                  ),
                ],
              ],
            ],
          ),
        );
      },
    );
  }

  static String _miles(int valor) {
    final texto = valor.toString();
    final buffer = StringBuffer();
    for (var i = 0; i < texto.length; i++) {
      if (i > 0 && (texto.length - i) % 3 == 0) buffer.write('.');
      buffer.write(texto[i]);
    }
    return buffer.toString();
  }
}


/// Tarjeta del club en Recompensas, con datos reales y acceso a /niveles.
///
/// Si el backend no responde muestra la tarjeta sin cifras y el acceso igual:
/// esconder la entrada por un fallo de red sería peor que no mostrar el XP.
class _TarjetaNivelReal extends StatefulWidget {
  const _TarjetaNivelReal();

  @override
  State<_TarjetaNivelReal> createState() => _TarjetaNivelRealState();
}

class _TarjetaNivelRealState extends State<_TarjetaNivelReal> {
  late final Future<NivelPuntos?> _futuro = RewardsService.obtenerNivel();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<NivelPuntos?>(
      future: _futuro,
      builder: (context, snap) {
        final n = snap.data;
        final cargando = snap.connectionState != ConnectionState.done;
        final avance = n == null
            ? 0.0
            : (n.esNivelMaximo ? 1.0 : (n.xp / (n.xpSiguienteNivel ?? 1)).clamp(0.0, 1.0));

        return Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () => Navigator.pushNamed(context, '/niveles'),
            borderRadius: BorderRadius.circular(18),
            child: Ink(
              width: double.infinity,
              padding: const EdgeInsets.all(LuxeSpacing.xl),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFFD4AF37), Color(0xFFAA7C11)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(18),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFFAA7C11).withValues(alpha: 0.3),
                    blurRadius: 16,
                    offset: const Offset(0, 6),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'SOCIO CLUB GLOW LUXE',
                        style: TextStyle(
                          fontFamily: 'JetBrainsMono',
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                          letterSpacing: 1.6,
                        ),
                      ),
                      const Icon(Icons.workspace_premium, color: Colors.white, size: 22),
                    ],
                  ),
                  const SizedBox(height: 20),
                  Text(
                    cargando ? '—' : '${n?.xp ?? 0} XP',
                    style: const TextStyle(
                      fontFamily: 'Didot',
                      fontSize: 34,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'PUNTOS DE EXPERIENCIA ACUMULADOS',
                    style: TextStyle(
                      fontFamily: 'JetBrainsMono',
                      fontSize: 9,
                      color: Colors.white70,
                      letterSpacing: 1.0,
                    ),
                  ),
                  const SizedBox(height: 18),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: LinearProgressIndicator(
                      value: avance,
                      minHeight: 6,
                      backgroundColor: Colors.white24,
                      valueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        cargando
                            ? 'Cargando tu nivel…'
                            : 'Nivel: ${n?.nivel ?? '—'}',
                        style: const TextStyle(
                          fontFamily: 'CormorantGaramond',
                          fontSize: 13,
                          color: Colors.white,
                        ),
                      ),
                      Text(
                        (n == null || n.esNivelMaximo)
                            ? 'Ver mi nivel ›'
                            : 'Siguiente: ${n.nivelSiguiente} (${n.xpSiguienteNivel} XP) ›',
                        style: const TextStyle(
                          fontFamily: 'CormorantGaramond',
                          fontSize: 13,
                          color: Colors.white,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
