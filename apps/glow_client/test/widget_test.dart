// This is a basic Flutter widget test.
// To perform an interaction with a widget in your test, use the WidgetTester
// utility in the flutter_test package.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:glow_client/main.dart';

void main() {
  testWidgets('GlowClientApp loads without crashing', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const ProviderScope(child: GlowClientApp()));

    // Verify that the app loads (shows login screen)
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
