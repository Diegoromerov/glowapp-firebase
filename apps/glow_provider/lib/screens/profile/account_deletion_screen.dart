import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:glow_core/glow_core.dart';

/// Eliminación de la cuenta del prestador desde la app.
///
/// App Store 5.1.1(v) y Google Play exigen que el titular pueda borrar su
/// cuenta sin salir de la aplicación. El backend ya lo soporta
/// (`DELETE /api/auth/delete-account`): anonimiza el usuario, revoca el
/// consentimiento biométrico y borra los escaneos.
///
/// El ticket ARCO de `settings_screen.dart` sigue existiendo como vía
/// alternativa para quien prefiera dejar rastro formal de la solicitud.
class AccountDeletionScreen extends StatefulWidget {
  const AccountDeletionScreen({super.key, this.userEmail});

  final String? userEmail;

  static const String palabra = 'ELIMINAR';

  @override
  State<AccountDeletionScreen> createState() => _AccountDeletionScreenState();
}

class _AccountDeletionScreenState extends State<AccountDeletionScreen> {
  final _confirmCtrl = TextEditingController();
  bool _enviando = false;
  String? _error;

  static const _tinta = Color(0xFF1F1A15);
  static const _cuerpo = Color(0xFF3A322C);
  static const _tenue = Color(0xFF6B6058);
  static const _fondo = Color(0xFFFDFBF7);
  static const _acento = Color(0xFF8A6A2F);
  static const _peligro = Color(0xFF9E4B3D);

  @override
  void dispose() {
    _confirmCtrl.dispose();
    super.dispose();
  }

  bool get _confirmado =>
      _confirmCtrl.text.trim().toUpperCase() == AccountDeletionScreen.palabra;

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
        if (!mounted) return;
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
      Navigator.of(context)
          .pushNamedAndRemoveUntil('/auth/login', (_) => false);
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
      backgroundColor: _fondo,
      appBar: AppBar(
        backgroundColor: _fondo,
        elevation: 0,
        iconTheme: const IconThemeData(color: _tinta),
        title: const Text(
          'Eliminar mi cuenta',
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontSize: 21,
            fontWeight: FontWeight.bold,
            color: _tinta,
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          Semantics(
            label: 'Advertencia: la eliminación de la cuenta no se puede deshacer',
            child: Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF4F1),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: const Color(0xFFE8C4BC)),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.warning_amber_rounded, color: _peligro, size: 22),
                  SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Esta acción no se puede deshacer. Tu cuenta de prestador '
                      'quedará cerrada, tus datos personales y biométricos se '
                      'eliminan y no podrás volver a iniciar sesión con este correo.',
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 14,
                        height: 1.45,
                        color: Color(0xFF5A3B33),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          _titulo('Antes de continuar'),
          _bullet('Puedes seguir cobrando lo que ya está devengado: las '
              'liquidaciones pendientes se pagan al ciclo normal.'),
          _bullet('Si tienes citas confirmadas, el cliente recibe la '
              'cancelación y el reembolso según la política vigente.'),
          _bullet('El salón del que eres dueño no se borra: hay que transferirlo '
              'o cerrarlo desde el panel del salón.'),
          const SizedBox(height: 18),
          _titulo('Qué se elimina'),
          _bullet('Nombre, correo, teléfono, foto de perfil y documentos cargados.'),
          _bullet('Tu consentimiento biométrico y los escaneos faciales asociados.'),
          _bullet('Sesiones abiertas en todos los dispositivos.'),
          const SizedBox(height: 18),
          _titulo('Qué se conserva'),
          _bullet('Facturas, liquidaciones y registros contables de servicios ya '
              'prestados, por obligación tributaria (5 años).'),
          _bullet('Disputas abiertas, hasta que se resuelvan.'),
          const SizedBox(height: 26),
          Text(
            widget.userEmail?.isNotEmpty == true
                ? 'Escribe ${AccountDeletionScreen.palabra} para confirmar la '
                    'eliminación de ${widget.userEmail}'
                : 'Escribe ${AccountDeletionScreen.palabra} para confirmar',
            style: const TextStyle(
              fontFamily: 'Manrope',
              fontSize: 13,
              height: 1.4,
              color: _tenue,
            ),
          ),
          const SizedBox(height: 8),
          Semantics(
            label: 'Campo de confirmación: escribe la palabra ELIMINAR',
            textField: true,
            child: TextField(
              controller: _confirmCtrl,
              textCapitalization: TextCapitalization.characters,
              inputFormatters: [LengthLimitingTextInputFormatter(10)],
              onChanged: (_) => setState(() {}),
              style: const TextStyle(
                fontFamily: 'Manrope',
                fontSize: 15,
                color: _tinta,
              ),
              decoration: InputDecoration(
                hintText: AccountDeletionScreen.palabra,
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
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(color: _acento, width: 1.6),
                ),
              ),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 14),
            Text(
              _error!,
              style: const TextStyle(
                fontFamily: 'Manrope',
                fontSize: 13,
                height: 1.4,
                color: _peligro,
              ),
            ),
          ],
          const SizedBox(height: 24),
          SizedBox(
            height: 52,
            child: FilledButton(
              onPressed: _confirmado && !_enviando ? _eliminar : null,
              style: FilledButton.styleFrom(
                backgroundColor: _peligro,
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
                        fontFamily: 'Manrope',
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
                  fontFamily: 'Manrope',
                  fontSize: 14,
                  color: _tenue,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _titulo(String texto) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Text(
          texto,
          style: const TextStyle(
            fontFamily: 'CormorantGaramond',
            fontSize: 19,
            fontWeight: FontWeight.bold,
            color: _tinta,
          ),
        ),
      );

  Widget _bullet(String texto) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.only(top: 6, right: 10),
              child: Icon(Icons.circle, size: 5, color: _acento),
            ),
            Expanded(
              child: Text(
                texto,
                style: const TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 14,
                  height: 1.5,
                  color: _cuerpo,
                ),
              ),
            ),
          ],
        ),
      );
}
