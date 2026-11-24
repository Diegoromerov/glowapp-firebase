import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/src/models/saas/saas_models.dart';

void main() {
  group('SaaS commercial availability', () {
    test('only production offers appear available when the API catalog fails',
        () {
      final available = SaasPlanTier.values
          .where((tier) => tier.isCommerciallyAvailable)
          .map((tier) => tier.code)
          .toList();

      expect(available, ['FREE_TRIAL', 'FREEMIUM', 'BASIC']);
    });

    test('only Basic is purchasable for new subscriptions', () {
      expect(
        SaasPlanTier.values
            .where((tier) => tier.isPurchasable)
            .map((tier) => tier.code)
            .toList(),
        ['BASIC'],
      );
    });
  });
}
