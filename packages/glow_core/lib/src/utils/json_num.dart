/// Conversión tolerante de valores JSON a double.
///
/// Postgres devuelve las columnas `numeric` como **String** (`"27350.00"`), y un
/// `as num?` sobre ese valor lanza `TypeError`: el `await` no continúa y la UI se
/// queda en el spinner para siempre (pasó en el checkout de la tienda).
double? toDoubleOrNull(dynamic value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value.trim());
  return null;
}

/// Igual que [toDoubleOrNull] pero con valor por defecto.
double toDoubleOr(dynamic value, double fallback) => toDoubleOrNull(value) ?? fallback;
