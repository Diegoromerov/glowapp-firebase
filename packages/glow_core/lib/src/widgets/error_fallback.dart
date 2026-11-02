import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Sustituto del rectángulo gris que Flutter pinta cuando un widget revienta.
///
/// En release el `ErrorWidget` por defecto es una caja gris sin texto: el
/// usuario no sabe qué pasó y quien da soporte no tiene con qué buscarlo. Esto
/// muestra un mensaje y un código corto que se cruza con los logs del backend
/// (`X-Trace-Id`).
class ErrorFallback extends StatelessWidget {
  const ErrorFallback({super.key, this.codigo});

  final String? codigo;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF121212),
      alignment: Alignment.center,
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.error_outline, color: Color(0xFFE8C4B8), size: 36),
          const SizedBox(height: 12),
          const Text(
            'Algo salió mal',
            style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 320),
            child: Text(
              'Cierra esta pantalla y vuelve a intentarlo. Si persiste, '
              'envía este código a soporte:',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFFBDBDBD), fontSize: 13, height: 1.4),
            ),
          ),
          const SizedBox(height: 10),
          SelectableText(
            codigo ?? 'SIN-CODIGO',
            style: const TextStyle(
              color: Color(0xFFE8C4B8), fontSize: 15, fontWeight: FontWeight.w700, letterSpacing: 1.2),
          ),
          if (kDebugMode) const SizedBox(height: 16),
          if (kDebugMode)
            const Text(
              'Modo debug: revisa la consola.',
              style: TextStyle(color: Color(0xFF8A8A8A), fontSize: 11),
            ),
        ],
      ),
    );
  }
}