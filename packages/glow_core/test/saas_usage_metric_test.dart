import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/src/models/saas/saas_models.dart';

void main() {
  group('SaaS usage metric quota semantics', () {
    test('identifies concurrent seat, resource and site limits', () {
      expect(UsageMetricType.staff.isConcurrentQuota, isTrue);
      expect(UsageMetricType.resources.isConcurrentQuota, isTrue);
      expect(UsageMetricType.sites.isConcurrentQuota, isTrue);
    });

    test('does not classify monthly consumption as concurrent capacity', () {
      expect(UsageMetricType.bookings.isConcurrentQuota, isFalse);
      expect(UsageMetricType.apiCalls.isConcurrentQuota, isFalse);
    });
  });
}
