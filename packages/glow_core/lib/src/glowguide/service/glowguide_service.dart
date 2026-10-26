// lib/glowguide/service/glowguide_service.dart
// Servicio global para la orquestación y navegación de GlowGuide

import 'package:flutter/material.dart';
import '../contracts/navigation_delegate.dart';
import '../contracts/screen_visibility.dart';
import '../engine/glowguide_engine.dart';
import '../model/glowguide_step.dart';
import '../audio/audio_engine.dart';
import '../persistence/persistence_engine.dart';
import '../observer/screen_visibility_observer.dart';

/// Servicio singleton que proporciona navegación global y estado del motor GlowGuide
class GlowGuideService implements NavigationDelegate {
  static final GlowGuideService instance = GlowGuideService._internal();
  GlowGuideService._internal();

  final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

  GlowGuideEngine? _engine;
  GlowGuideEngine? get engine => _engine;

  late final ScreenVisibilityObserver _screenVisibilityObserver;
  late final AudioEngine _audioEngine;
  late final PersistenceEngine _persistenceEngine;

  bool _isInitialized = false;

  void initialize() {
    if (_isInitialized) return;

    _screenVisibilityObserver = ScreenVisibilityObserverSingleton.instance;
    _audioEngine = AudioEngine();
    _persistenceEngine = PersistenceEngine();

    _isInitialized = true;
  }

  /// Crea y configura el engine con los pasos específicos de la app
  /// Debe llamarse después de initialize() con los pasos de la guía correspondiente
  void createEngine({
    required List<GlowGuideStep> steps,
    required String guideId,
  }) {
    if (!_isInitialized) {
      initialize();
    }

    _engine = GlowGuideEngine(
      steps: steps,
      guideId: guideId,
      navigationDelegate: this,
      audioController: _audioEngine,
      persistenceAdapter: _persistenceEngine,
      screenVisibilityObserver: _screenVisibilityObserver,
    );
  }

  @override
  Future<NavigationResult> navigate({
    required String routeName,
    Map<String, dynamic>? arguments,
    required Duration timeout,
  }) async {
    final navState = navigatorKey.currentState;
    if (navState == null) {
      return NavigationResult.failure(routeName, 'NavigatorState no disponible');
    }
    try {
      navState.pushNamed(routeName, arguments: arguments);
      return NavigationResult.success(routeName);
    } catch (e) {
      return NavigationResult.failure(routeName, e.toString());
    }
  }

  @override
  Future<NavigationResult> returnToHome({required Duration timeout}) async {
    final navState = navigatorKey.currentState;
    if (navState == null) {
      return NavigationResult.failure('/home', 'NavigatorState no disponible');
    }
    try {
      navState.popUntil((route) => route.settings.name == '/home');
      return NavigationResult.success('/home');
    } catch (e) {
      return NavigationResult.failure('/home', e.toString());
    }
  }

  @override
  void cancelPending() {}
}
