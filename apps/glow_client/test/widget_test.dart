// This is a basic Flutter widget test.
// To perform an interaction with a widget in your test, use the WidgetTester
// utility in the flutter_test package.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:glow_client/main.dart';
import 'package:glow_client/services/map_tile_config.dart';
import 'package:glow_core/glow_core.dart';

void main() {
  setUpAll(() {
    MapTileConfig.enabled = false;
    ConnectivityService.probe = () async => true;
  });
  tearDownAll(() {
    MapTileConfig.enabled = true;
    ConnectivityService.resetForTesting();
  });

  testWidgets('GlowClientApp loads without crashing', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const ProviderScope(child: GlowClientApp()));

    // Verify that the app loads (shows login screen)
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
