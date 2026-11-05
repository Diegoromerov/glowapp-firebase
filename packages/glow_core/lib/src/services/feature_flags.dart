// packages/glow_core/lib/src/services/feature_flags.dart
//
// Ítem 80 — banderas de función.
//
// Sirven para apagar algo (propinas, tienda) sin publicar versión nueva: el
// backend responde en `GET /api/config/flags` y la app deja de mostrar lo que
// esté apagado.
//
// Regla de oro: `activo()` es FAIL-OPEN. Si el backend no responde, si el JSON
// viene raro o si la bandera no existe, devuelve `true`. Una caída de red no
// puede dejar a los usuarios sin funciones que ya tenían.

import 'dart:convert';

import 'package:flutter/foundation.dart';

/// Servicio de banderas, con caché en memoria y refresco opcional.
class FeatureFlags {
  FeatureFlags._();

  static final FeatureFlags instance = FeatureFlags._();

  Map<String, bool> _flags = const {};
  DateTime? _actualizado;
  bool _cargando = false;

  /// Última lectura efectiva (para diagnóstico y pruebas).
  Map<String, bool> get valores => Map.unmodifiable(_flags);

  DateTime? get actualizadoEn => _actualizado;

  /// ¿La función está encendida? Sin dato ⇒ encendida.
  bool activo(String clave) => _flags[clave] ?? true;

  /// Carga desde el backend. No lanza: si falla, mantiene lo que tuviera.
  Future<void> cargar({required Future<dynamic> Function() obtener}) async {
    if (_cargando) return;
    _cargando = true;
    try {
      final respuesta = await obtener();
      final mapa = _extraerFlags(respuesta);
      if (mapa != null) {
        _flags = mapa;
        _actualizado = DateTime.now();
      }
    } catch (error) {
      debugPrint('[FLAGS] no se pudieron cargar: $error');
    } finally {
      _cargando = false;
    }
  }

  /// Acepta tanto el cuerpo ya decodificado como un JSON en texto.
  Map<String, bool>? _extraerFlags(dynamic respuesta) {
    dynamic cuerpo = respuesta;
    if (cuerpo is String) {
      try {
        cuerpo = jsonDecode(cuerpo);
      } catch (_) {
        return null;
      }
    }
    if (cuerpo is! Map) return null;
    final crudo = cuerpo['flags'] ?? cuerpo['data'];
    if (crudo is! Map) return null;

    final salida = <String, bool>{};
    crudo.forEach((clave, valor) {
      if (valor is bool) salida[clave.toString()] = valor;
    });
    return salida;
  }

  /// Solo para pruebas: fija un estado sin pasar por la red.
  @visibleForTesting
  void fijarParaPruebas(Map<String, bool> flags) {
    _flags = Map<String, bool>.from(flags);
    _actualizado = DateTime.now();
  }
}
