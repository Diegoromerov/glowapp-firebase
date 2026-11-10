import 'package:flutter/material.dart';

/// Claves globales de la app.
///
/// Viven fuera de `main.dart` para que servicios que no son widgets (el de
/// push, por ejemplo) puedan mostrar algo en pantalla sin arrastrar toda la
/// jerarquía de imports de la aplicación.
final GlobalKey<ScaffoldMessengerState> rootMessengerKey =
    GlobalKey<ScaffoldMessengerState>();
