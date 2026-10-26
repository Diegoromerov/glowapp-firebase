// Barrel export for glow_core
// FASE 1: Exports activados tras mover archivos reales

// Services (export main files that handle conditional exports internally)
export 'src/services/active_salon_service.dart';
export 'src/services/analytics_service.dart';
export 'src/services/api_service.dart';
export 'src/services/app_update_service.dart';
export 'src/services/audience_service.dart';
export 'src/services/audio_player.dart';          // handles conditional export internally
export 'src/services/auth_service.dart';
export 'src/services/biometric_service.dart';
export 'src/services/booking_recovery_service.dart';
export 'src/services/business_api_service.dart';
export 'src/services/connectivity_service.dart';  // handles conditional import internally
export 'src/services/crash_reporting_service.dart';
export 'src/services/dispute_service.dart';
export 'src/services/fcm_service.dart';
export 'src/services/location_service.dart';
export 'src/services/notification_service.dart';
export 'src/services/permission_rationale_service.dart';
export 'src/services/reply_reconcile.dart';
export 'src/services/saas_api_service.dart';
export 'src/services/secure_storage_service.dart';
export 'src/services/social_share_service.dart';
export 'src/services/superadmin_api_service.dart';
export 'src/services/support_service.dart';
export 'src/services/web_geolocation.dart';       // handles conditional export internally

// Models
export 'src/models/biometric_result.dart';
export 'src/models/business_profile_model.dart';
export 'src/models/glow_cycle_model.dart';
export 'src/models/glow_product.dart';
export 'src/models/owner_dashboard_metrics.dart';
export 'src/models/provider_model.dart';
export 'src/models/service_model.dart';
export 'src/models/saas/saas_models.dart';
export 'src/models/superadmin/superadmin_models.dart';

// Design / Theme
export 'src/design/components/academy_luxe_components.dart';
export 'src/design/components/luxe_components.dart';
export 'src/design/components/s4_loading.dart';
export 'src/design/components/s4_text_field.dart';
export 'src/design/icons/glow_icon.dart';
export 'src/design/icons/glow_icon_adapter.dart';
export 'src/design/icons/glow_icon_demo.dart';
export 'src/design/icons/glow_icon_registry.dart';
export 'src/design/icons/glow_icon_registry_init.dart';

// Core (only modern AppTheme from app_theme.dart)
export 'src/core/theme/app_theme.dart';
export 'src/core/theme/belleza_luxe_gradients.dart';
export 'src/core/theme/belleza_luxe_theme.dart';
export 'src/core/theme/tokens.dart' hide AppTheme;  // hide legacy AppTheme from tokens.dart

// Shared (hide legacy AppTheme from shared/theme.dart)
export 'src/shared/app_tokens.dart';
export 'src/shared/calculations.dart';
export 'src/shared/currency_formatter.dart';
export 'src/shared/glow_store_tokens.dart';
export 'src/shared/glow_tokens.dart';
export 'src/shared/mens_theme.dart';
export 'src/shared/onboarding_helper.dart';
export 'src/shared/theme.dart' hide AppTheme;
export 'src/shared/widgets/background_video_player.dart';

// Widgets (genéricos + owner + profile)
export 'src/widgets/app_update_gate.dart';
export 'src/widgets/audience_toggle.dart';
export 'src/widgets/aura_3d_emblem.dart';
export 'src/widgets/forced_update_dialog.dart';
export 'src/widgets/glass_card.dart';
export 'src/widgets/glow_glass_card.dart';
export 'src/widgets/invitation_code_entry.dart';
export 'src/widgets/locked_feature_card.dart';
export 'src/widgets/owner/cross_tenant_warning_banner.dart';
export 'src/widgets/profile/colombian_address_builder.dart';
export 'src/widgets/profile/delivery_addresses_section.dart';
export 'src/widgets/profile/luxe_list_tile.dart';
export 'src/widgets/profile/profile_header.dart';
export 'src/widgets/product_quick_view_dialog.dart';
export 'src/widgets/store_product_card.dart';
export 'src/widgets/voice_input.dart';
export 'src/widgets/wompi_payment_sheet.dart';

// Utils
export 'src/utils/json_num.dart';

// Data
export 'src/data/colombia_municipalities.dart';

// L10n
export 'src/l10n/app_localizations.dart';
export 'src/l10n/app_localizations_en.dart';
export 'src/l10n/app_localizations_es.dart';

// GlowGuide (motor ONLY - config files are app-specific)
export 'src/glowguide/glowguide.dart';
export 'src/glowguide/engine/glowguide_engine.dart';
export 'src/glowguide/contracts/audio_controller.dart';
export 'src/glowguide/contracts/failure_policy.dart';
export 'src/glowguide/contracts/navigation_delegate.dart';
export 'src/glowguide/contracts/persistence_adapter.dart';
export 'src/glowguide/contracts/screen_visibility.dart';
export 'src/glowguide/observer/screen_visibility_observer.dart';
export 'src/glowguide/persistence/persistence_engine.dart';
export 'src/glowguide/presenter/glowguide_presenter.dart';
export 'src/glowguide/service/glowguide_service.dart';
export 'src/glowguide/state/glowguide_state.dart';
export 'src/glowguide/model/glowguide_action.dart';
export 'src/glowguide/model/glowguide_step.dart';
export 'src/glowguide/utils/glowguide_utils.dart';
export 'src/glowguide/audio/audio_engine.dart';
export 'src/glowguide/config/video_mapping.dart';
