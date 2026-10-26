// lib/services/connectivity_probe_stub.dart
//
// Fallback del sondeo para plataformas sin dart:io (web).
//
// En el navegador no existe una API de DNS síncrona y universal, así que el
// sondeo se declara "alcanzable" y la detección real de caídas queda en manos
// del resultado de las peticiones HTTP (SocketException / TimeoutException),
// que el motor de reintentos de ApiService clasifica igualmente.

import 'dart:async';

Future<bool> probeReachability(String host, Duration timeout) async => true;
