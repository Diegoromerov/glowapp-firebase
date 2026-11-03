// Confirmación del servicio con código de 6 dígitos.
//
// Antes era un stub que aceptaba CUALQUIER código y devolvía `true` sin consultar
// al backend. La validación real vive en `POST /api/bookings/:id/confirm-otp`,
// que comprueba el código contra `otp_validaciones` y libera el pago: decidirlo
// en el cliente dejaba ese control de seguridad en manos de nadie.
import 'package:flutter/material.dart';
// `glow_core/services.dart` es la biblioteca pública de servicios: evita importar
// lib/src (implementation_imports) y no arrastra el tema, así la pantalla se
// puede probar sin compilar el barrel completo.
import 'package:glow_core/services.dart';
import '../widgets/service_review_sheet.dart';

class OtpConfirmScreen extends StatefulWidget {
  final String bookingId;
  final String prestadorNombre;
  final String servicioNombre;
  final double valorBruto;

  /// Costura de prueba: por defecto consulta al backend.
  final Future<bool> Function(String codigo)? verificar;

  const OtpConfirmScreen({
    super.key,
    required this.bookingId,
    required this.prestadorNombre,
    required this.servicioNombre,
    required this.valorBruto,
    this.verificar,
  });

  @override
  State<OtpConfirmScreen> createState() => _OtpConfirmScreenState();
}

class _OtpConfirmScreenState extends State<OtpConfirmScreen> {
  final _controllers = List.generate(6, (_) => TextEditingController());
  final _focusNodes = List.generate(6, (_) => FocusNode());
  bool _isLoading = false;
  // Tras verificar el codigo no se cierra la pantalla: es el unico momento con
  // el cliente presente y el servicio recien recibido, o sea el mejor sitio
  // para pedir la calificacion. Aqui nace la mayor parte de las resenas.
  bool _exitoso = false;

  @override
  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    for (final f in _focusNodes) {
      f.dispose();
    }
    super.dispose();
  }

  Future<void> _verifyOtp() async {
    final otp = _controllers.map((c) => c.text).join();
    if (otp.length != 6) return;
    if (_isLoading) return;

    setState(() => _isLoading = true);
    try {
      final verificar = widget.verificar ??
          (String codigo) => ApiService.confirmBookingOtp(widget.bookingId, codigo);
      final ok = await verificar(otp);
      if (!mounted) return;
      setState(() => _isLoading = false);
      if (ok) {
        setState(() => _exitoso = true);
      } else {
        _aviso('Código incorrecto o vencido.');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _isLoading = false);
      _aviso('No se pudo verificar el código: $e');
    }
  }

  void _aviso(String mensaje) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(mensaje)));
  }

  Future<void> _calificar(int nota) async {
    final publicada = await showServiceReviewSheet(
      context,
      bookingId: widget.bookingId,
      providerName: widget.prestadorNombre,
      initialRating: nota,
    );
    if (!mounted) return;
    // Con resena o sin ella el flujo termina igual: la confirmacion del servicio
    // ya se hizo y no puede quedar retenida por una calificacion opcional.
    Navigator.pop(context, publicada == true || true);
  }

  Widget _buildExito() {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.check_circle_rounded,
                  size: 64, color: Color(0xFF4A5D4E)),
              const SizedBox(height: 16),
              const Text('Servicio confirmado',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Text(
                'Pago liberado a ${widget.prestadorNombre}.',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 13, color: Color(0xFF8A7F72)),
              ),
              const SizedBox(height: 32),
              Text(
                '¿Cómo te fue con ${widget.prestadorNombre}?',
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(
                  5,
                  (i) => IconButton(
                    iconSize: 38,
                    tooltip: '${i + 1} de 5',
                    onPressed: () => _calificar(i + 1),
                    icon: const Icon(Icons.star_outline_rounded,
                        color: Color(0xFFC5A052)),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              const Text('Un toque y listo. Puedes ampliar después.',
                  style: TextStyle(fontSize: 12, color: Color(0xFF8A7F72))),
              const SizedBox(height: 24),
              TextButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Ahora no',
                    style: TextStyle(color: Color(0xFF8A7F72))),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_exitoso) return _buildExito();
    return Scaffold(
      appBar: AppBar(title: const Text('Verificar código')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              'Ingresa el código para\n${widget.servicioNombre}\ncon ${widget.prestadorNombre}',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: List.generate(6, (i) {
                return SizedBox(
                  width: 48,
                  height: 56,
                  child: TextField(
                    controller: _controllers[i],
                    focusNode: _focusNodes[i],
                    textAlign: TextAlign.center,
                    keyboardType: TextInputType.number,
                    maxLength: 1,
                    decoration: InputDecoration(
                      counterText: '',
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    onChanged: (v) {
                      if (v.isNotEmpty && i < 5) {
                        _focusNodes[i + 1].requestFocus();
                      } else if (v.isEmpty && i > 0) {
                        _focusNodes[i - 1].requestFocus();
                      }
                      if (_controllers.map((c) => c.text).join().length == 6) {
                        _verifyOtp();
                      }
                    },
                  ),
                );
              }),
            ),
            const SizedBox(height: 24),
            if (_isLoading)
              const CircularProgressIndicator()
            else
              ElevatedButton(
                onPressed: _verifyOtp,
                child: const Text('Verificar'),
              ),
          ],
        ),
      ),
    );
  }
}
