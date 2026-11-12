// Invitar amigas: el programa de referidos que ya existía en el backend
// (`GET /api/auth/referral-info` devuelve código, enlace y mensaje con el crédito
// de $5.000 COP en puntos) y que no tenía ninguna entrada en la app.
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import 'package:glow_core/glow_core.dart';

class InviteFriendsScreen extends StatefulWidget {
  const InviteFriendsScreen({super.key});

  @override
  State<InviteFriendsScreen> createState() => _InviteFriendsScreenState();
}

class _InviteFriendsScreenState extends State<InviteFriendsScreen> {
  bool _cargando = true;
  String? _error;
  bool _errorEsSesion = false;
  String? _codigo;
  String? _mensaje;
  String? _enlace;
  int _convertidos = 0;
  int _puntosGanados = 0;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() {
      _cargando = true;
      _error = null;
    });
    try {
      final res = await ApiService.get('/api/auth/referral-info');
      final datos = (res['data'] ?? res) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _codigo = datos['referral_code']?.toString();
        _mensaje = datos['share_message']?.toString();
        _enlace = datos['share_url']?.toString();
        _convertidos = (datos['referidos_convertidos'] as num?)?.toInt() ?? 0;
        _puntosGanados = (datos['puntos_ganados'] as num?)?.toInt() ?? 0;
        _cargando = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = mensajeHumano(e);
        // Con la sesión caída, «Reintentar» no puede funcionar: la pantalla
        // ofrece iniciar sesión en vez de un botón que falla en bucle.
        _errorEsSesion = esErrorDeSesion(e);
        _cargando = false;
      });
    }
  }

  Future<void> _compartir() async {
    final texto = _mensaje ??
        'Te invito a GlowApp${_codigo != null ? ' con mi código $_codigo' : ''}.';
    try {
      await SharePlus.instance.share(ShareParams(
        title: 'Invitar a GlowApp',
        subject: 'Tu crédito de bienvenida en GlowApp',
        text: _enlace != null && !texto.contains(_enlace!) ? '$texto $_enlace' : texto,
      ));
    } catch (e) {
      debugPrint('No se pudo abrir la hoja de compartir: $e');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('No se pudo abrir la hoja de compartir.'),
        behavior: SnackBarBehavior.floating,
      ));
    }
  }

  Future<void> _copiarCodigo() async {
    final codigo = _codigo;
    if (codigo == null) return;
    await Clipboard.setData(ClipboardData(text: codigo));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text('Código $codigo copiado'),
      behavior: SnackBarBehavior.floating,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final t = Token.of(context);
    return Scaffold(
      backgroundColor: t.surfaceLevel0,
      appBar: AppBar(
        backgroundColor: t.surfaceLevel0,
        elevation: 0,
        title: const Text(
          'Invitar amigas',
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontWeight: FontWeight.bold,
            fontSize: 20,
          ),
        ),
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: _cuerpo(t),
            ),
          ),
        ),
      ),
    );
  }

  Widget _cuerpo(Token t) {
    if (_cargando) return const Center(child: CircularProgressIndicator());

    if (_error != null) {
      return Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            _errorEsSesion ? Icons.lock_outline : Icons.cloud_off,
            color: t.textSecondary,
            size: 36,
          ),
          const SizedBox(height: 12),
          Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: t.textSecondary)),
          const SizedBox(height: 16),
          if (_errorEsSesion)
            FilledButton(
              onPressed: () => Navigator.of(context).pushNamed('/auth/login'),
              child: const Text('Iniciar sesión'),
            )
          else
            OutlinedButton(onPressed: _cargar, child: const Text('Reintentar')),
        ],
      );
    }

    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(Icons.card_giftcard, size: 44, color: Color(0xFFC5A052)),
        const SizedBox(height: 16),
        Text(
          'Gana 500 puntos (hasta \$5.000) por cada amiga que compre',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontSize: 22,
            fontWeight: FontWeight.bold,
            color: t.textPrimary,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Comparte tu código. Cuando tu invitada hace su primera compra de '
          'productos sumas 500 puntos, que valen hasta \$5.000 en descuentos y '
          'se van usando en varias compras. Ella también puede invitar a las '
          'suyas: tu red crece contigo.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 13, height: 1.4, color: t.textSecondary),
        ),
        if (_convertidos > 0) ...[
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: t.surfaceLevel1,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: t.borderDefault),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.groups_outlined, size: 18, color: Color(0xFFC5A052)),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    '$_convertidos ${_convertidos == 1 ? 'amiga ya compró' : 'amigas ya compraron'}'
                    ' · $_puntosGanados puntos ganados',
                    style: TextStyle(fontSize: 12, color: t.textPrimary),
                  ),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 24),
        if (_codigo != null)
          InkWell(
            onTap: _copiarCodigo,
            borderRadius: BorderRadius.circular(16),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 18),
              decoration: BoxDecoration(
                color: t.surfaceLevel1,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: t.borderDefault),
              ),
              child: Column(
                children: [
                  Text(
                    _codigo!,
                    style: TextStyle(
                      fontSize: 24,
                      letterSpacing: 4,
                      fontWeight: FontWeight.bold,
                      color: t.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text('Toca para copiar',
                      style: TextStyle(fontSize: 11, color: t.textSecondary)),
                ],
              ),
            ),
          ),
        const SizedBox(height: 20),
        ElevatedButton.icon(
          onPressed: _compartir,
          icon: const Icon(Icons.ios_share, size: 18),
          label: const Text('Compartir invitación'),
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFFC5A052),
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
        ),
        if (kIsWeb) ...[
          const SizedBox(height: 12),
          Text(
            'El enlace lleva tu código: quien se registre desde ahí queda '
            'atribuido automáticamente. Si ya tiene la app instalada, puede '
            'escribir tu código en el registro.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11, color: t.textSecondary),
          ),
        ],
        const SizedBox(height: 8),
        TextButton(
          onPressed: () => Navigator.pushNamed(context, '/programa-puntos'),
          child: const Text(
            'Ver condiciones del programa',
            style: TextStyle(fontSize: 12, decoration: TextDecoration.underline),
          ),
        ),
      ],
    );
  }
}
