// apps/glow_client/lib/widgets/auth_gate.dart
//
// Puerta de autenticación POR ACCIÓN, no por pantalla.
//
// La app cliente se abre en modo exploración: cualquiera puede ver prestadores,
// mapa, categorías y detalle sin cuenta. La identificación se pide en el momento
// exacto en que la acción la necesita (reservar, comprar, Glow IA+), para no
// bloquear la primera impresión del producto.
import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

class AuthGate {
  AuthGate._();

  /// True si hay token en el almacén cifrado (misma fuente que usa la API).
  ///
  /// Con tope de tiempo a propósito: si el almacén cifrado no responde (web con
  /// IndexedDB bloqueado, plugin ausente en tests) `read` puede quedarse
  /// colgado y el usuario tocaría "Reservar" sin que pase nada. Ante duda se
  /// trata como visitante y se le ofrece la hoja, que es recuperable.
  static Future<bool> tieneSesion() async {
    try {
      final token = await AuthService.getToken()
          .timeout(const Duration(milliseconds: 1500));
      return token != null && token.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  /// Pide sesión solo si hace falta.
  ///
  /// Devuelve `true` cuando el usuario ya tenía sesión o acaba de autenticarse,
  /// y `false` si prefirió seguir explorando. Quien llama decide qué hacer con
  /// ese booleano: no navega por su cuenta ni pierde la acción que el usuario
  /// había pedido.
  static Future<bool> requerir(
    BuildContext context, {
    required String accion,
    String? detalle,
    Future<bool> Function()? comprobarSesion,
  }) async {
    final comprobar = comprobarSesion ?? tieneSesion;

    if (await comprobar()) return true;
    if (!context.mounted) return false;

    final eleccion = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.black.withValues(alpha: 0.45),
      builder: (_) => _HojaAccionProtegida(accion: accion, detalle: detalle),
    );

    if (eleccion == null) return false; // "Seguir explorando"
    if (!context.mounted) return false;

    await Navigator.pushNamed(
      context,
      eleccion == 'registro' ? '/auth/register' : '/auth/login',
    );

    // El login reemplaza su ruta por /home, así que al volver solo queda
    // comprobar si la sesión existe de verdad.
    return comprobar();
  }
}

class _HojaAccionProtegida extends StatelessWidget {
  const _HojaAccionProtegida({required this.accion, this.detalle});

  final String accion;
  final String? detalle;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final texto = Theme.of(context).textTheme;

    return SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.all(12),
        padding: const EdgeInsets.fromLTRB(24, 12, 24, 20),
        decoration: BoxDecoration(
          color: scheme.surface,
          borderRadius: BorderRadius.circular(28),
          border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.4)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.18),
              blurRadius: 28,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 44,
                height: 4,
                margin: const EdgeInsets.only(bottom: 18),
                decoration: BoxDecoration(
                  color: scheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            Container(
              width: 56,
              height: 56,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: scheme.primary.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.lock_outline_rounded, color: scheme.primary, size: 26),
            ),
            const SizedBox(height: 16),
            Text(
              'Creá tu cuenta para $accion',
              textAlign: TextAlign.center,
              style: texto.titleMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              detalle ??
                  'Podés explorar GlowApp sin cuenta. Solo te pedimos identificarte '
                      'cuando vas a $accion, para guardar tu historial y proteger tu reserva.',
              textAlign: TextAlign.center,
              style: texto.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
                height: 1.35,
              ),
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: () => Navigator.pop(context, 'registro'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(50),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
              child: const Text('Crear cuenta'),
            ),
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed: () => Navigator.pop(context, 'login'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(50),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
              child: const Text('Ya tengo cuenta'),
            ),
            const SizedBox(height: 4),
            TextButton(
              onPressed: () => Navigator.pop(context, null),
              child: const Text('Seguir explorando'),
            ),
          ],
        ),
      ),
    );
  }
}
