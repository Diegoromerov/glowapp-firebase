// Stub for OtpConfirmScreen - originally in monolito, not copied to glow_client
// Y-F2: será implementada completamente en Fase posterior
import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

class OtpConfirmScreen extends StatefulWidget {
  final String bookingId;
  final String prestadorNombre;
  final String servicioNombre;
  final double valorBruto;

  const OtpConfirmScreen({
    super.key,
    required this.bookingId,
    required this.prestadorNombre,
    required this.servicioNombre,
    required this.valorBruto,
  });

  @override
  State<OtpConfirmScreen> createState() => _OtpConfirmScreenState();
}

class _OtpConfirmScreenState extends State<OtpConfirmScreen> {
  final _controllers = List.generate(6, (_) => TextEditingController());
  final _focusNodes = List.generate(6, (_) => FocusNode());
  bool _isLoading = false;

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

  void _verifyOtp() async {
    final otp = _controllers.map((c) => c.text).join();
    if (otp.length != 6) return;

    setState(() => _isLoading = true);
    // TODO: Implementar verificación real con AuthService
    await Future.delayed(const Duration(seconds: 1));
    if (mounted) {
      setState(() => _isLoading = false);
      Navigator.pop(context, true);
    }
  }

  @override
  Widget build(BuildContext context) {
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
