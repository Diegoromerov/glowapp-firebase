// frontend/lib/models/glow_cycle_model.dart

class GlowCycle {
  final String id;
  final String cycleType;
  final String status;
  final String targetGoal;
  final String targetMetricKey;
  final double baselineValue;
  final double targetValue;
  final double currentValue;
  final int durationDays;
  final String planSummary;
  final List<dynamic> amRoutine;
  final List<dynamic> pmRoutine;
  final List<dynamic> recommendedProducts;
  final List<dynamic> recommendedServices;
  final String? startDate;
  final String? endDate;
  final Map<String, dynamic>? continuity;
  final List<dynamic> measurements;

  GlowCycle({
    required this.id,
    required this.cycleType,
    required this.status,
    required this.targetGoal,
    required this.targetMetricKey,
    required this.baselineValue,
    required this.targetValue,
    required this.currentValue,
    required this.durationDays,
    required this.planSummary,
    required this.amRoutine,
    required this.pmRoutine,
    required this.recommendedProducts,
    required this.recommendedServices,
    this.startDate,
    this.endDate,
    this.continuity,
    this.measurements = const [],
  });

  factory GlowCycle.fromJson(Map<String, dynamic> json) {
    return GlowCycle(
      id: json['id']?.toString() ?? '',
      cycleType: json['cycle_type'] ?? json['cycleType'] ?? 'skin',
      status: json['status'] ?? 'active',
      targetGoal: json['target_goal'] ?? json['targetGoal'] ?? '',
      targetMetricKey: json['target_metric_key'] ?? json['targetMetricKey'] ?? 'hydration',
      baselineValue: (json['baseline_value'] ?? json['baselineValue'] ?? 50.0).toDouble(),
      targetValue: (json['target_value'] ?? json['targetValue'] ?? 75.0).toDouble(),
      currentValue: (json['current_value'] ?? json['currentValue'] ?? 50.0).toDouble(),
      durationDays: (json['duration_days'] ?? json['durationDays'] ?? 30) as int,
      planSummary: json['plan_summary'] ?? json['planSummary'] ?? '',
      amRoutine: json['am_routine'] is List ? json['am_routine'] : (json['amRoutine'] is List ? json['amRoutine'] : []),
      pmRoutine: json['pm_routine'] is List ? json['pm_routine'] : (json['pmRoutine'] is List ? json['pmRoutine'] : []),
      recommendedProducts: json['recommended_product_ids'] is List ? json['recommended_product_ids'] : (json['recommendedProducts'] is List ? json['recommendedProducts'] : []),
      recommendedServices: json['recommended_service_ids'] is List ? json['recommended_service_ids'] : (json['recommendedServices'] is List ? json['recommendedServices'] : []),
      startDate: json['start_date']?.toString() ?? json['startDate']?.toString(),
      endDate: json['end_date']?.toString() ?? json['endDate']?.toString(),
      continuity: json['continuity'] is Map<String, dynamic> ? json['continuity'] : null,
      measurements: json['measurements'] is List ? json['measurements'] : [],
    );
  }
}
