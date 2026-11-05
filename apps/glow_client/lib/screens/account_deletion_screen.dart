import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:glow_core/glow_core.dart';

/// Eliminación de la cuenta desde la app.
///
/// App Store 5.1.1(v) y Google Play exigen que el usuario pueda borrar su
/// cuenta sin salir de la aplicación. El backend ya lo soporta
/// (`DELETE /api/auth/delete-account`); faltaba la pantalla.
class AccountDeletionScreen extends StatefulWidget {
  const AccountDeletionScreen({super.key, this.userEmail});

  final String? userEmail;

  @override
  State<AccountDeletionScreen> createState() => _AccountDeletionScreenState();
}

class _AccountDeletionScreenState extends State<AccountDeletionScreen> {
  final _confirmCtrl = TextEditingController();
  bool _enviando = false;
  String? _error;

  static const _palabra = 'ELIMINAR';

  @override
  void dispose() {
    _confirmCtrl.dispose();
    super.dispose();
  }

  bool get _confirmado =>
      _confirmCtrl.text.trim().toUpperCase() == _palabra;

  Future<void> _eliminar() async {
    if (!_confirmado || _enviando) return;
    setState(() {
      _enviando = true;
      _error = null;
    });

    try {
      final res = await ApiService.delete('/api/auth/delete-account');
      final ok = res is Map && res['success'] == true;
      if (!ok) {
        setState(() {
          _error = res is Map
              ? (res['error']?.toString() ?? 'No se pudo eliminar la cuenta.')
              : 'No se pudo eliminar la cuenta.';
          _enviando = false;
        });
        return;
      }

      await AuthService.logout();
      if (!mounted) return;
      Navigator.of(context).pushNamedAndRemoveUntil('/auth/login', (_) => false);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = mensajeHumano(e);
        _enviando = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFDFBF7),
      appBar: AppBar(
        backgroundColor: const Color(0xFFFDFBF7),
        elevation: 0,
        title: const Text(
          'Eliminar mi cuenta',
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontSize: 21,
            fontWeight: FontWeight.bold,
            color: Color(0xFF1F1A15),
          ),
        ),
        iconTheme: const IconThemeData(color: Color(0xFF1F1A15)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF4F1),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: const Color(0xFFE8C4BC)),
            ),
            child: const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.warning_amber_rounded, color: Color(0xFF9E4B3D), size: 22),
                SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Esta acción no se puede deshacer. Tu cuenta quedará cerrada '
                    'y tus datos personales y biométricos se eliminarán.',
                    style: TextStyle(
                      fontFamily: 'Inter',
                      fontSize: 14,
                      height: 1.45,
                      color: Color(0xFF5A3B33),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            'Qué pasa cuando eliminas tu cuenta',
            style: TextStyle(
              fontFamily: 'CormorantGaramond',
              fontSize: 19,
              fontWeight: FontWeight.bold,
              color: Color(0xFF1F1A15),
            ),
          ),
          const SizedBox(height: 10),
          _bullet('Se borran tu nombre, correo, teléfono y foto de perfil.'),
          _bullet('Se revoca tu consentimiento biométrico y se eliminan los escaneos faciales.'),
          _bullet('Se cierran tus sesiones en todos los dispositivos.'),
          _bullet('No podrás volver a iniciar sesión con este correo.'),
          const SizedBox(height: 14),
          const Text(
            'Qué conservamos',
            style: TextStyle(
              fontFamily: 'CormorantGaramond',
              fontSize: 19,
              fontWeight: FontWeight.bold,
              color: Color(0xFF1F1A15),
            ),
          ),
          const SizedBox(height: 10),
          _bullet('Las facturas y registros contables de servicios ya prestados, '
              'por obligación tributaria (5 años).'),
          _bullet('Los registros de disputas abiertas hasta que se resuelvan.'),
          const SizedBox(height: 26),
          Text(
            widget.userEmail?.isNotEmpty == true
                ? 'Escribe ${_palabra} para confirmar la eliminación de ${widget.userEmail}'
                : 'Escribe $_palabra para confirmar',
            style: const TextStyle(
              fontFamily: 'Inter',
              fontSize: 13,
              color: Color(0xFF8C7E74),
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _confirmCtrl,
            textCapitalization: TextCapitalization.characters,
            inputFormatters: [LengthLimitingTextInputFormatter(10)],
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: _palabra,
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: const BorderSide(color: Color(0xFFE8DFD8)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: const BorderSide(color: Color(0xFFE8DFD8)),
              ),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 14),
            Text(
              _error!,
              style: const TextStyle(
                fontFamily: 'Inter',
                fontSize: 13,
                color: Color(0xFF9E4B3D),
              ),
            ),
          ],
          const SizedBox(height: 24),
          SizedBox(
            height: 52,
            child: FilledButton(
              onPressed: _confirmado && !_enviando ? _eliminar : null,
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF9E4B3D),
                disabledBackgroundColor: const Color(0xFFE0D6CF),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              child: _enviando
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text(
                      'Eliminar mi cuenta definitivamente',
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: Colors.white,
                      ),
                    ),
            ),
          ),
          const SizedBox(height: 14),
          Center(
            child: TextButton(
              onPressed: _enviando ? null : () => Navigator.of(context).pop(),
              child: const Text(
                'Cancelar',
                style: TextStyle(
                  fontFamily: 'Inter',
                  fontSize: 14,
                  color: Color(0xFF8C7E74),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _bullet(String texto) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.only(top: 6, right: 10),
              child: Icon(Icons.circle, size: 5, color: Color(0xFFC5A052)),
            ),
            Expanded(
              child: Text(
                texto,
                style: const TextStyle(
                  fontFamily: 'Inter',
                  fontSize: 14,
                  height: 1.5,
                  color: Color(0xFF3A322C),
                ),
              ),
            ),
          ],
        ),
      );
}
