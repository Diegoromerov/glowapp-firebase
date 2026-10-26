// lib/glowguide/engine/glowguide_engine.dart
// Motor de orquestación para GlowGuide
// I1: Foundation Repair - usa contratos para navegación, audio, persistencia.

import 'dart:async';
import '../state/glowguide_state.dart';
import '../model/glowguide_step.dart';
import '../model/glowguide_action.dart';
import '../contracts/navigation_delegate.dart';
import '../contracts/audio_controller.dart';
import '../contracts/persistence_adapter.dart';
import '../contracts/failure_policy.dart';
import '../contracts/screen_visibility.dart';

/// Callback para notificar cambios de estado
typedef GlowGuideStateListener = void Function(GlowGuideState state);

/// Motor principal de GlowGuide
/// Responsable de orquestar el estado y la secuencia de pasos.
/// NO posee Navigator, AudioPlayer, ni SharedPreferences directamente.
/// Delega a: NavigationDelegate, AudioController, PersistenceAdapter.
class GlowGuideEngine {
  final List<GlowGuideStep> _steps;
  final String guideId;
  final NavigationDelegate _navigationDelegate;
  final AudioController _audioController;
  final PersistenceAdapter _persistenceAdapter;
  final ScreenVisibilityObserver _screenVisibilityObserver;

  GlowGuideState _state = GlowGuideState.initial;
  final List<GlowGuideStateListener> _listeners = [];
  bool _disposed = false;
  AudioPlayback? _currentPlayback;

  /// Paso actual (null si no hay)
  GlowGuideStep? get currentStep {
    if (_state.currentStepId == null) return null;
    try {
      return _steps.firstWhere((s) => s.id == _state.currentStepId);
    } catch (_) {
      return null;
    }
  }

  /// Total de pasos configurados en la guía
  int get totalSteps => _steps.length;

  /// Estado actual (inmutable)
  GlowGuideState get state => _state;

  /// Si hay paso siguiente
  bool get hasNext => _state.hasNext;

  /// Si hay paso anterior
  bool get hasPrevious => _state.hasPrevious;

  /// Si la guía está completada
  bool get isCompleted => _state.status == GlowGuideStatus.completed;

  /// Si la guía fue descartada
  bool get isDismissed => _state.status == GlowGuideStatus.dismissed;

  /// Si la guía está activa (playing, executingAction, paused)
  bool get isActive => _state.status == GlowGuideStatus.playing ||
      _state.status == GlowGuideStatus.executingAction ||
      _state.status == GlowGuideStatus.paused;

  GlowGuideEngine({
    required List<GlowGuideStep> steps,
    required this.guideId,
    required NavigationDelegate navigationDelegate,
    required AudioController audioController,
    required PersistenceAdapter persistenceAdapter,
    required ScreenVisibilityObserver screenVisibilityObserver,
  }) : _steps = List.unmodifiable(steps),
       _navigationDelegate = navigationDelegate,
       _audioController = audioController,
       _persistenceAdapter = persistenceAdapter,
       _screenVisibilityObserver = screenVisibilityObserver;

  /// Registra un listener de cambios de estado
  void addListener(GlowGuideStateListener listener) {
    _listeners.add(listener);
  }

  /// Remueve un listener
  void removeListener(GlowGuideStateListener listener) {
    _listeners.remove(listener);
  }

  /// Notifica a todos los listeners
  void _notify() {
    for (final listener in _listeners) {
      listener(_state);
    }
  }

  /// Actualiza estado interno y notifica
  void _updateState(GlowGuideState newState) {
    _state = newState;
    _notify();
  }

  /// Inicia la guía desde el primer paso
  Future<void> start() async {
    if (_disposed) return;

    if (_steps.isEmpty) {
      _updateState(_state.copyWith(
        status: GlowGuideStatus.dismissed,
        error: 'No steps configured',
      ));
      return;
    }

    // Verificar persistencia antes de iniciar
    final completed = await _persistenceAdapter.isGuideCompleted(guideId);
    if (completed) {
      _updateState(_state.copyWith(
        status: GlowGuideStatus.dismissed,
        error: 'Already completed',
      ));
      return;
    }

    _updateState(_state.copyWith(
      status: GlowGuideStatus.starting,
      totalSteps: _steps.length,
    ));

    try {
      await _audioController.initialize();

      final firstStep = _steps.first;
      _updateState(_state.copyWith(
        status: GlowGuideStatus.playing,
        currentStepId: firstStep.id,
        currentStepIndex: 0,
        hasNext: _steps.length > 1,
        hasPrevious: false,
        transitionContext: {'action': 'start'},
      ));

      // Reproducir audio del primer paso si existe
      if (firstStep.audioAssetId != null) {
        await _playAudioWithTimeout(firstStep.audioAssetId!);
      }

      // Ejecutar acción del primer paso si existe y es blocking
      if (firstStep.action != null && firstStep.action!.blocking) {
        await _executeAction(firstStep.action!);
      }
    } catch (e) {
      _updateState(_state.copyWith(
        status: GlowGuideStatus.dismissed,
        error: e.toString(),
      ));
    }
  }

  /// Avanza al siguiente paso
  Future<void> next() async {
    if (_disposed || !hasNext || currentStep == null) return;

    final currentIndex = _state.currentStepIndex;
    final nextIndex = currentIndex + 1;

    if (nextIndex >= _steps.length) {
      await complete();
      return;
    }

    final nextStep = _steps[nextIndex];

    _updateState(_state.copyWith(
      status: GlowGuideStatus.playing,
      currentStepId: nextStep.id,
      currentStepIndex: nextIndex,
      hasNext: nextIndex < _steps.length - 1,
      hasPrevious: true,
      transitionContext: {'action': 'next', 'fromStep': currentStep!.id},
    ));

    // Reproducir audio del siguiente paso
    if (nextStep.audioAssetId != null) {
      await _playAudioWithTimeout(nextStep.audioAssetId!);
    }

    // Ejecutar acción si existe y es blocking
    if (nextStep.action != null && nextStep.action!.blocking) {
      await _executeAction(nextStep.action!);
    }
  }

  /// Retrocede al paso anterior
  Future<void> previous() async {
    if (_disposed || !hasPrevious || currentStep == null) return;

    final currentIndex = _state.currentStepIndex;
    final prevIndex = currentIndex - 1;

    if (prevIndex < 0) return;

    final prevStep = _steps[prevIndex];

    _updateState(_state.copyWith(
      status: GlowGuideStatus.playing,
      currentStepId: prevStep.id,
      currentStepIndex: prevIndex,
      hasNext: true,
      hasPrevious: prevIndex > 0,
      transitionContext: {'action': 'previous', 'fromStep': currentStep!.id},
    ));

    // Reproducir audio del paso anterior
    if (prevStep.audioAssetId != null) {
      await _playAudioWithTimeout(prevStep.audioAssetId!);
    }

    // Ejecutar acción si existe y es blocking
    if (prevStep.action != null && prevStep.action!.blocking) {
      await _executeAction(prevStep.action!);
    }
  }

  /// Completa la guía exitosamente
  Future<void> complete() async {
    await _audioController.stop();
    _currentPlayback = null;

    await _persistenceAdapter.markGuideCompleted(guideId);

    _updateState(_state.copyWith(
      status: GlowGuideStatus.completed,
      currentStepId: null,
      hasNext: false,
      hasPrevious: false,
      transitionContext: {'action': 'complete'},
    ));
  }

  /// Descarta la guía (usuario la cierra)
  Future<void> dismiss() async {
    await _audioController.stop();
    _currentPlayback = null;

    // dismissed NO se persiste automáticamente (solo estado operacional)

    _updateState(_state.copyWith(
      status: GlowGuideStatus.dismissed,
      currentStepId: null,
      hasNext: false,
      hasPrevious: false,
      transitionContext: {'action': 'dismiss'},
    ));
  }

  /// Reinicia la guía desde el principio (replay)
  Future<void> replay() async {
    await _audioController.stop();
    _currentPlayback = null;
    await start();
  }

  /// Forzar el reinicio manual del tutorial completado o descartado
  Future<void> forceRestart() async {
    await _audioController.stop();
    _currentPlayback = null;
    await _persistenceAdapter.clearAll();
    _updateState(GlowGuideState.initial);
    await start();
  }

  /// Pausa la guía
  Future<void> pause() async {
    if (_disposed) return;
    if (_state.status == GlowGuideStatus.playing ||
        _state.status == GlowGuideStatus.executingAction) {
      await _audioController.pause();
      _updateState(_state.copyWith(
        status: GlowGuideStatus.paused,
        transitionContext: {'action': 'pause'},
      ));
    }
  }

  /// Reanuda la guía pausada
  Future<void> resume() async {
    if (_disposed) return;
    if (_state.status == GlowGuideStatus.paused) {
      await _audioController.resume();
      _updateState(_state.copyWith(
        status: GlowGuideStatus.playing,
        transitionContext: {'action': 'resume'},
      ));
    }
  }

  /// Ejecuta una acción declarativa (navegación, highlight, etc.)
  Future<void> _executeAction(GlowGuideAction action) async {
    if (_disposed) return;

    _updateState(_state.copyWith(
      status: GlowGuideStatus.executingAction,
      transitionContext: {
        'action': 'execute',
        'actionType': action.type.name,
        'target': action.target,
      },
    ));

    try {
      switch (action.type) {
        case GlowGuideActionType.navigate:
          await _executeNavigation(action);
          break;
        case GlowGuideActionType.highlight:
        case GlowGuideActionType.open:
        case GlowGuideActionType.close:
        case GlowGuideActionType.focus:
        case GlowGuideActionType.wait:
          // No implementados en I1 - solo simular duración
          await Future.delayed(Duration(milliseconds: action.estimatedDurationMs));
          break;
        case GlowGuideActionType.custom:
          // Provider uses the presenter completion callback to select each tab.
          break;
      }
    } catch (e) {
      // FailurePolicy maneja el error; continuar flujo
      print('GlowGuide action execution failed: $e');
    }

    if (!_disposed && _state.status == GlowGuideStatus.executingAction) {
      _updateState(_state.copyWith(
        status: GlowGuideStatus.playing,
        transitionContext: {'action': 'actionCompleted'},
      ));
    }
  }

  /// Ejecuta navegación real con confirmación de visibilidad
  Future<void> _executeNavigation(GlowGuideAction action) async {
    final routeName = action.target;
    const timeout = FailurePolicy.navigationTimeout;

    // Retornar primeramente a /home para garantizar la secuencia perfil -> home -> secundaria -> home
    await _navigationDelegate.returnToHome(timeout: timeout);

    if (routeName == '/home') {
      return;
    }

    // 1. Registrar espera de visibilidad ANTES de navegar a la sub-pantalla
    final visibilityFuture = _screenVisibilityObserver.waitForVisible(routeName, timeout);

    // 2. Ejecutar navegación a la sub-pantalla
    final result = await _navigationDelegate.navigate(
      routeName: routeName,
      arguments: action.parameters['arguments'] as Map<String, dynamic>?,
      timeout: timeout,
    );

    // 3. Esperar confirmación de visibilidad
    final visibilityStatus = await visibilityFuture;

    // 4. Evaluar resultado
    if (result.status == NavigationStatus.success && visibilityStatus == ScreenVisibilityStatus.visible) {
      // Navegación exitosa y pantalla visible
      return;
    } else if (result.status == NavigationStatus.timeout || visibilityStatus == ScreenVisibilityStatus.hidden) {
      // Timeout - aplicar FailurePolicy
      _handleNavigationTimeout(routeName);
    } else if (result.status == NavigationStatus.failure) {
      // Ruta no disponible u otro error - aplicar FailurePolicy
      _handleRouteUnavailable(routeName, result.errorMessage);
    } else if (result.status == NavigationStatus.cancelled) {
      // Cancelado por usuario o dispose
      return;
    }
  }

  void _handleNavigationTimeout(String routeName) {
    switch (FailurePolicy.navigationTimeoutBehavior) {
      case NavigationTimeoutBehavior.skipStep:
        // Continuar al siguiente paso
        break;
      case NavigationTimeoutBehavior.dismissGuide:
        dismiss();
        break;
      case NavigationTimeoutBehavior.retryOnce:
        // No implementado en I1
        break;
    }
  }

  void _handleRouteUnavailable(String routeName, String? error) {
    switch (FailurePolicy.routeUnavailableBehavior) {
      case RouteUnavailableBehavior.skipStep:
        break;
      case RouteUnavailableBehavior.dismissGuide:
        dismiss();
        break;
      case RouteUnavailableBehavior.showError:
        _updateState(_state.copyWith(
          status: GlowGuideStatus.dismissed,
          error: 'Route unavailable: $routeName',
        ));
        break;
    }
  }

  /// Reproduce audio con timeout de protección
  Future<void> _playAudioWithTimeout(String assetId) async {
    if (_disposed) return;

    try {
      _currentPlayback = _audioController.play(assetId);

      // Race condition: completado vs timeout
      final completed = _currentPlayback!.events
          .firstWhere((e) => e.type == AudioEventType.completed || e.type == AudioEventType.error)
          .timeout(FailurePolicy.audioCompletionTimeout);

      await completed;
    } on TimeoutException {
      // Timeout de audio - protección, no flujo normal
      _handleAudioTimeout(assetId);
    } catch (e) {
      // Error de audio - aplicar FailurePolicy
      _handleAudioError(assetId, e.toString());
    } finally {
      _currentPlayback = null;
    }
  }

  void _handleAudioTimeout(String assetId) {
    switch (FailurePolicy.audioErrorBehavior) {
      case AudioErrorBehavior.skipAudioContinueStep:
        // Saltar audio, continuar paso (flujo normal)
        break;
      case AudioErrorBehavior.pauseGuide:
        pause();
        break;
      case AudioErrorBehavior.dismissGuide:
        dismiss();
        break;
    }
  }

  void _handleAudioError(String assetId, String error) {
    switch (FailurePolicy.audioErrorBehavior) {
      case AudioErrorBehavior.skipAudioContinueStep:
        break;
      case AudioErrorBehavior.pauseGuide:
        pause();
        break;
      case AudioErrorBehavior.dismissGuide:
        dismiss();
        break;
    }
  }

  /// Obtiene un paso por ID
  GlowGuideStep? getStep(String stepId) {
    try {
      return _steps.firstWhere((s) => s.id == stepId);
    } catch (_) {
      return null;
    }
  }

  /// Obtiene todos los pasos
  List<GlowGuideStep> get allSteps => List.unmodifiable(_steps);

  /// Libera recursos
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _listeners.clear();
    await _currentPlayback?.cancel();
    _currentPlayback = null;
    await _audioController.dispose();
    _navigationDelegate.cancelPending();
  }
}
