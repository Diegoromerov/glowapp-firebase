import 'package:flutter/widgets.dart';

const backgroundLocationConsentVersion = '2026-11-background-v1';

bool hasBackgroundLocationConsent({
  required bool enabled,
  required String? consentVersion,
  required bool isWeb,
}) =>
    !isWeb && enabled && consentVersion == backgroundLocationConsentVersion;

bool shouldStopLocationTrackingForLifecycle(
  AppLifecycleState state, {
  required bool hasBackgroundConsent,
}) {
  if (state == AppLifecycleState.detached) return true;
  if (state == AppLifecycleState.inactive ||
      state == AppLifecycleState.paused) {
    return !hasBackgroundConsent;
  }
  return false;
}
