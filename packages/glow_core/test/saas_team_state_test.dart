import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';

void main() {
  group('TeamState error lifecycle', () {
    test('clears a previous action error after a successful team reload', () {
      final previousError = Exception('404 Invitación pendiente no encontrada');
      final state = TeamState(error: previousError, isLoading: true);

      final refreshed = state.copyWith(isLoading: false, clearError: true);

      expect(refreshed.error, isNull);
      expect(refreshed.isLoading, isFalse);
    });

    test('keeps the current error unless explicitly cleared or replaced', () {
      final previousError = Exception('Fallo anterior');
      final nextError = Exception('Fallo de carga');
      final state = TeamState(error: previousError);

      expect(state.copyWith(isLoading: false).error, same(previousError));
      expect(state.copyWith(error: nextError).error, same(nextError));
    });
  });
}
