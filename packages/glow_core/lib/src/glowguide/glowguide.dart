// lib/glowguide/glowguide.dart
// Barrel export para el módulo GlowGuide
// Punto de entrada público del módulo

// State
export 'state/glowguide_state.dart';

// Models
export 'model/glowguide_step.dart';
export 'model/glowguide_action.dart';

// Utils
export 'utils/glowguide_utils.dart';

// Contracts
export 'contracts/navigation_delegate.dart';
export 'contracts/audio_controller.dart';
export 'contracts/screen_visibility.dart';
export 'contracts/persistence_adapter.dart';
export 'contracts/failure_policy.dart';

// Engine
export 'engine/glowguide_engine.dart';

// Presenter
export 'presenter/glowguide_presenter.dart';

// Service
export 'service/glowguide_service.dart';

// Implementations (internal)
export 'audio/audio_engine.dart';
export 'persistence/persistence_engine.dart';
export 'observer/screen_visibility_observer.dart';
