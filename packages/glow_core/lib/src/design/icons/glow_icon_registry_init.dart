/// GlowIcon Registry Initialization
///
/// Call this during app startup to register all GlowIcon implementations.
/// Should be called before runApp() in main.dart.
///
/// Example:
///   void main() async {
///     WidgetsFlutterBinding.ensureInitialized();
///     GlowIconRegistryInit.initialize();
///     runApp(const MyApp());
///   }

library glow_icon_registry_init;

import 'glow_icon_registry.dart';

/// Initialize the GlowIcon registry with all core and proprietary icons.
class GlowIconRegistryInit {
  static bool _initialized = false;

  /// Register all GlowIcon implementations.
  static void initialize() {
    if (_initialized) return;
    _initialized = true;

    // =========================================================================
    // CORE ICONS (16 P0 icons) - SVG assets
    // =========================================================================

    GlowIconRegistry.register('home', const GlowIconData(
      semanticName: 'home',
      assetPath: 'home.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('search', const GlowIconData(
      semanticName: 'search',
      assetPath: 'search.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('menu', const GlowIconData(
      semanticName: 'menu',
      assetPath: 'menu.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('close', const GlowIconData(
      semanticName: 'close',
      assetPath: 'close.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('back', const GlowIconData(
      semanticName: 'back',
      assetPath: 'back.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('forward', const GlowIconData(
      semanticName: 'forward',
      assetPath: 'forward.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('more', const GlowIconData(
      semanticName: 'more',
      assetPath: 'more.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('profile', const GlowIconData(
      semanticName: 'profile',
      assetPath: 'profile.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('heart', const GlowIconData(
      semanticName: 'heart',
      assetPath: 'heart.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('bag', const GlowIconData(
      semanticName: 'bag',
      assetPath: 'bag.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('cart', const GlowIconData(
      semanticName: 'cart',
      assetPath: 'cart.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('calendar', const GlowIconData(
      semanticName: 'calendar',
      assetPath: 'calendar.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('wallet', const GlowIconData(
      semanticName: 'wallet',
      assetPath: 'wallet.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('school', const GlowIconData(
      semanticName: 'school',
      assetPath: 'school.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('clock', const GlowIconData(
      semanticName: 'clock',
      assetPath: 'clock.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('location', const GlowIconData(
      semanticName: 'location',
      assetPath: 'location.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('settings', const GlowIconData(
      semanticName: 'settings',
      assetPath: 'settings.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('notification', const GlowIconData(
      semanticName: 'notification',
      assetPath: 'notification.svg',
      defaultStrokeWidth: 1.75,
    ));

    // =========================================================================
    // PROPRIETARY ICONS (6 I1 icons) - SVG assets
    // =========================================================================

    GlowIconRegistry.register('glow', const GlowIconData(
      semanticName: 'glow',
      assetPath: 'glow.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('aura', const GlowIconData(
      semanticName: 'aura',
      assetPath: 'aura.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('concierge', const GlowIconData(
      semanticName: 'concierge',
      assetPath: 'concierge.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('beauty_ritual', const GlowIconData(
      semanticName: 'beauty_ritual',
      assetPath: 'beauty_ritual.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('glow_recommendation', const GlowIconData(
      semanticName: 'glow_recommendation',
      assetPath: 'glow_recommendation.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('male_grooming', const GlowIconData(
      semanticName: 'male_grooming',
      assetPath: 'male_grooming.svg',
      defaultStrokeWidth: 1.75,
    ));

    // =========================================================================
    // BEAUTY EXTENDED ICONS (8 I2-A icons) - SVG assets
    // =========================================================================

    GlowIconRegistry.register('skincare', const GlowIconData(
      semanticName: 'skincare',
      assetPath: 'skincare.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('hair', const GlowIconData(
      semanticName: 'hair',
      assetPath: 'hair.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('nails', const GlowIconData(
      semanticName: 'nails',
      assetPath: 'nails.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('makeup', const GlowIconData(
      semanticName: 'makeup',
      assetPath: 'makeup.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('fragrance', const GlowIconData(
      semanticName: 'fragrance',
      assetPath: 'fragrance.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('body', const GlowIconData(
      semanticName: 'body',
      assetPath: 'body.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('wellness', const GlowIconData(
      semanticName: 'wellness',
      assetPath: 'wellness.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('spa', const GlowIconData(
      semanticName: 'spa',
      assetPath: 'spa.svg',
      defaultStrokeWidth: 1.75,
    ));

    // =========================================================================
    // NEW ICONS FOR BOOKING / PROVIDER DETAIL / LOGIN
    // =========================================================================

    GlowIconRegistry.register('note', const GlowIconData(
      semanticName: 'note',
      assetPath: 'note.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('check', const GlowIconData(
      semanticName: 'check',
      assetPath: 'check.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('radio_selected', const GlowIconData(
      semanticName: 'radio_selected',
      assetPath: 'radio_selected.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('radio_unselected', const GlowIconData(
      semanticName: 'radio_unselected',
      assetPath: 'radio_unselected.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('plus', const GlowIconData(
      semanticName: 'plus',
      assetPath: 'plus.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('minus', const GlowIconData(
      semanticName: 'minus',
      assetPath: 'minus.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('security', const GlowIconData(
      semanticName: 'security',
      assetPath: 'security.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('verified', const GlowIconData(
      semanticName: 'verified',
      assetPath: 'verified.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('person', const GlowIconData(
      semanticName: 'person',
      assetPath: 'person.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('content_cut', const GlowIconData(
      semanticName: 'content_cut',
      assetPath: 'content_cut.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('brush', const GlowIconData(
      semanticName: 'brush',
      assetPath: 'brush.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('face', const GlowIconData(
      semanticName: 'face',
      assetPath: 'face.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('face_retouching', const GlowIconData(
      semanticName: 'face_retouching',
      assetPath: 'face_retouching.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('style', const GlowIconData(
      semanticName: 'style',
      assetPath: 'style.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('photo', const GlowIconData(
      semanticName: 'photo',
      assetPath: 'photo.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('email', const GlowIconData(
      semanticName: 'email',
      assetPath: 'email.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('lock', const GlowIconData(
      semanticName: 'lock',
      assetPath: 'lock.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('visibility', const GlowIconData(
      semanticName: 'visibility',
      assetPath: 'visibility.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('visibility_off', const GlowIconData(
      semanticName: 'visibility_off',
      assetPath: 'visibility_off.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('star', const GlowIconData(
      semanticName: 'star',
      assetPath: 'star.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('google', const GlowIconData(
      semanticName: 'google',
      assetPath: 'google.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('outlook', const GlowIconData(
      semanticName: 'outlook',
      assetPath: 'outlook.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('apple', const GlowIconData(
      semanticName: 'apple',
      assetPath: 'apple.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('chevron_left', const GlowIconData(
      semanticName: 'chevron_left',
      assetPath: 'chevron_left.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('chevron_right', const GlowIconData(
      semanticName: 'chevron_right',
      assetPath: 'chevron_right.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('people_alt', const GlowIconData(
      semanticName: 'people_alt',
      assetPath: 'people_alt.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('local_offer', const GlowIconData(
      semanticName: 'local_offer',
      assetPath: 'local_offer.svg',
      defaultStrokeWidth: 1.75,
    ));

    // =========================================================================
    // MEN EXTENDED ICONS (5 I2-B icons) - SVG assets
    // =========================================================================

    GlowIconRegistry.register('beard', const GlowIconData(
      semanticName: 'beard',
      assetPath: 'beard.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('shave', const GlowIconData(
      semanticName: 'shave',
      assetPath: 'shave.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('scalp', const GlowIconData(
      semanticName: 'scalp',
      assetPath: 'scalp.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('mens_fragrance', const GlowIconData(
      semanticName: 'mens_fragrance',
      assetPath: 'mens_fragrance.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('mens_body', const GlowIconData(
      semanticName: 'mens_body',
      assetPath: 'mens_body.svg',
      defaultStrokeWidth: 1.75,
    ));

    // =========================================================================
    // CONCIERGE EXTENDED ICONS (4 I2-C icons) - SVG assets
    // =========================================================================

    GlowIconRegistry.register('booking', const GlowIconData(
      semanticName: 'booking',
      assetPath: 'booking.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('chat', const GlowIconData(
      semanticName: 'chat',
      assetPath: 'chat.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('wishlist', const GlowIconData(
      semanticName: 'wishlist',
      assetPath: 'wishlist.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('support', const GlowIconData(
      semanticName: 'support',
      assetPath: 'support.svg',
      defaultStrokeWidth: 1.75,
    ));

    // =========================================================================
    // AURA EXTENDED ICONS (6 I2-D icons) - SVG assets
    // =========================================================================

    GlowIconRegistry.register('scan', const GlowIconData(
      semanticName: 'scan',
      assetPath: 'scan.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('analyze', const GlowIconData(
      semanticName: 'analyze',
      assetPath: 'analyze.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('learn', const GlowIconData(
      semanticName: 'learn',
      assetPath: 'learn.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('predict', const GlowIconData(
      semanticName: 'predict',
      assetPath: 'predict.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('evolve', const GlowIconData(
      semanticName: 'evolve',
      assetPath: 'evolve.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('sync', const GlowIconData(
      semanticName: 'sync',
      assetPath: 'sync.svg',
      defaultStrokeWidth: 1.75,
    ));

    // =========================================================================
    // SYSTEM EXTENDED ICONS (6 I2-E icons) - SVG assets
    // =========================================================================

    GlowIconRegistry.register('share', const GlowIconData(
      semanticName: 'share',
      assetPath: 'share.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('download', const GlowIconData(
      semanticName: 'download',
      assetPath: 'download.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('upload', const GlowIconData(
      semanticName: 'upload',
      assetPath: 'upload.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('filter', const GlowIconData(
      semanticName: 'filter',
      assetPath: 'filter.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('sort', const GlowIconData(
      semanticName: 'sort',
      assetPath: 'sort.svg',
      defaultStrokeWidth: 1.75,
    ));

    GlowIconRegistry.register('qr', const GlowIconData(
      semanticName: 'qr',
      assetPath: 'qr.svg',
      defaultStrokeWidth: 1.75,
    ));
  }

  /// Check if registry has been initialized.
  static bool get isInitialized => _initialized;

  /// Reset for testing.
  static void reset() {
    _initialized = false;
    GlowIconRegistry.clear();
  }
}