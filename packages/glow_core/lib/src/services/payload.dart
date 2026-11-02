/// Convierte el campo `data` de una respuesta en una lista de mapas.
///
/// Antes se hacía `data['data'] as List<dynamic>`: si el backend respondía 200
/// sin `data` como lista, la app moría con `TypeError` en vez de mostrar una
/// pantalla vacía. Una respuesta que no trae la lista esperada se trata como
/// vacía, no como una excepción.
List<Map<String, dynamic>> asMapList(dynamic value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((e) => Map<String, dynamic>.from(e))
      .toList();
}
