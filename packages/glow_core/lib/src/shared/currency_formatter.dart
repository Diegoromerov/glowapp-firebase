// frontend/lib/shared/currency_formatter.dart

class CurrencyFormatter {
  /// Formatea un monto numérico a formato de peso colombiano COP (ej: $15.000 COP)
  static String formatCOP(double amount) {
    final intVal = amount.round();
    final formatted = intVal.toString().replaceAllMapped(
          RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'),
          (Match m) => '${m[1]}.',
        );
    return '\$$formatted COP';
  }
}
