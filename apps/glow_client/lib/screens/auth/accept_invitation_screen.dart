import 'package:flutter/material.dart';
import 'package:glow_core/services/auth_service.dart';

class AcceptInvitationScreen extends StatefulWidget {
  final String? token;
  const AcceptInvitationScreen({super.key, this.token});

  @override
  State<AcceptInvitationScreen> createState() => _AcceptInvitationScreenState();
}

class _AcceptInvitationScreenState extends State<AcceptInvitationScreen> {
  bool _isLoading = false;
  String? _error;
  String? _successMessage;

  /// El token llega por argumento de ruta cuando se entra desde la app, pero la
  /// pantalla también se abre sin él. Sin este campo, quien no tuviera el enlace
  /// a mano leía "Token de invitación no proporcionado" y no había forma de
  /// escribir el código que le pasó el dueño del salón.
  final _tokenCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tokenCtrl.text = widget.token ?? '';
  }

  @override
  void dispose() {
    _tokenCtrl.dispose();
    super.dispose();
  }

  Future<void> _handleAccept() async {
    final effectiveToken = _tokenCtrl.text.trim().toLowerCase();
    if (effectiveToken.isEmpty) {
      setState(() => _error = 'Escribe el código de invitación.');
      return;
    }
    if (!RegExp(r'^[0-9a-f]{32}$').hasMatch(effectiveToken)) {
      setState(
          () => _error = 'El código debe tener 32 caracteres hexadecimales.');
      return;
    }
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final res = await AuthService.acceptSalonInvitation(effectiveToken);
      if (res != null && res['success'] == true) {
        setState(() {
          _successMessage = res['message'] ?? 'Invitación aceptada exitosamente.';
        });
        Future.delayed(const Duration(seconds: 2), () {
          if (mounted) {
            Navigator.pushReplacementNamed(context, '/home');
          }
        });
      } else {
        setState(() {
          _error = res?['error'] ?? 'No se pudo procesar la invitación.';
        });
      }
    } catch (e) {
      setState(() => _error = 'Error de conexión: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Invitación de Salón')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.storefront, size: 72, color: Color(0xFFE91E63)),
              const SizedBox(height: 20),
              const Text(
                'Invitación de Equipo de Salón',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              const Text(
                'Has sido invitado a unirte al equipo de trabajo de un salón registrado en GlowApp.',
                style: TextStyle(fontSize: 14, color: Colors.grey),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 30),
              if (_successMessage != null) ...[
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.green.shade50,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.green),
                  ),
                  child: Text(_successMessage!, style: const TextStyle(color: Colors.green, fontWeight: FontWeight.bold)),
                ),
              ] else if (_error != null) ...[
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.red),
                  ),
                  child: Text(_error!, style: const TextStyle(color: Colors.red)),
                ),
                const SizedBox(height: 20),
              ],
              if (_successMessage == null) ...[
                TextField(
                  controller: _tokenCtrl,
                  textAlign: TextAlign.center,
                  autocorrect: false,
                  enableSuggestions: false,
                  decoration: const InputDecoration(
                    labelText: 'Código de invitación',
                    hintText: '32 caracteres hexadecimales',
                    border: OutlineInputBorder(),
                  ),
                  style: const TextStyle(fontSize: 14, letterSpacing: 1.2),
                  onSubmitted: (_) => _handleAccept(),
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: _isLoading ? null : _handleAccept,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFE91E63),
                    padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: _isLoading
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Text('Aceptar Invitación', style: TextStyle(fontSize: 16, color: Colors.white, fontWeight: FontWeight.bold)),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
