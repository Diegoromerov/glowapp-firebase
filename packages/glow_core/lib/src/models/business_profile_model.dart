import 'package:flutter/material.dart';

/// GLOWAPP BUSINESS ENGINE MODELS (Dart 3.x Refactored)
/// Strong typed Enums, immutability, and JSON serialization.

enum TaskStage {
  entender('ENTENDER', 'Entender el Requisito', Icons.help_outline),
  explicar('EXPLICAR', 'Explicar por qué Importa', Icons.info_outline),
  recomendar('RECOMENDAR', 'Recomendación Aura AI', Icons.auto_awesome),
  ejecutar('EJECUTAR', 'Ejecutar Acción', Icons.play_circle_outline),
  verificar('VERIFICAR', 'Cargar Evidencia', Icons.verified_outlined);

  final String code;
  final String label;
  final IconData icon;
  const TaskStage(this.code, this.label, this.icon);

  static TaskStage fromCode(String code) {
    final clean = code.toUpperCase().trim();
    return TaskStage.values.firstWhere(
      (e) => e.code == clean,
      orElse: () => TaskStage.entender,
    );
  }
}

enum TaskStatus {
  pending('PENDIENTE', Colors.orange),
  inProgress('EN PROCESO', Color(0xFF3B82F6)),
  submitted('EN REVISIÓN', Color(0xFF8B5CF6)),
  verified('VERIFICADO', Color(0xFF10B981)),
  expired('VENCIDO', Color(0xFFF43F5E));

  final String label;
  final Color color;
  const TaskStatus(this.label, this.color);

  static TaskStatus fromCode(String code) {
    final clean = code.toUpperCase().trim();
    return TaskStatus.values.firstWhere(
      (e) => e.label == clean || e.name.toUpperCase() == clean,
      orElse: () => TaskStatus.pending,
    );
  }
}

enum FindingRiskLevel {
  low('LOW', 'Bajo', Color(0xFF10B981)),
  medium('MEDIUM', 'Medio', Color(0xFFF59E0B)),
  high('HIGH', 'Alto', Color(0xFFEF4444)),
  critical('CRITICAL', 'Crítico', Color(0xFF991B1B));

  final String code;
  final String label;
  final Color color;
  const FindingRiskLevel(this.code, this.label, this.color);

  static FindingRiskLevel fromCode(String code) {
    final clean = code.toUpperCase().trim();
    return FindingRiskLevel.values.firstWhere(
      (e) => e.code == clean,
      orElse: () => FindingRiskLevel.medium,
    );
  }
}

@immutable
class BusinessProfileModel {
  final String id;
  final String providerId;
  final String verticalId;
  final String name;
  final String onboardingMode; // NEW_BUSINESS, EXISTING_BUSINESS
  final String lifecycleStage; // IDEA, CONSTITUTION, FORMALIZATION, OPENING, OPERATION, AUDIT, GROWTH
  final double complianceScore;
  final String city;
  final String country;

  const BusinessProfileModel({
    required this.id,
    required this.providerId,
    required this.verticalId,
    required this.name,
    required this.onboardingMode,
    required this.lifecycleStage,
    required this.complianceScore,
    required this.city,
    required this.country,
  });

  factory BusinessProfileModel.fromJson(Map<String, dynamic> json) {
    return BusinessProfileModel(
      id: json['id'] as String? ?? '',
      // `business_profiles.provider_id` es INTEGER en la base (migración
      // 012_business_engine.sql: apunta a usuarios.id), así que la API lo
      // devuelve como número, no como texto. Castearlo a String? reventaba con
      // "type 'int' is not a subtype of type 'String?'" en CADA proveedor real y
      // la pantalla caía al estado de error.
      providerId: json['provider_id']?.toString() ?? '',
      verticalId: json['vertical_id'] as String? ?? '',
      name: json['name'] as String? ?? 'Mi Negocio de Belleza',
      onboardingMode: json['onboarding_mode'] as String? ?? 'NEW_BUSINESS',
      lifecycleStage: json['lifecycle_stage'] as String? ?? 'IDEA',
      complianceScore: ((json['compliance_score'] ?? 0) as num).toDouble(),
      city: json['city'] as String? ?? 'Bogotá',
      country: json['country'] as String? ?? 'Colombia',
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'provider_id': providerId,
        'vertical_id': verticalId,
        'name': name,
        'onboarding_mode': onboardingMode,
        'lifecycle_stage': lifecycleStage,
        'compliance_score': complianceScore,
        'city': city,
        'country': country,
      };
}

@immutable
class BusinessTaskModel {
  final String id;
  final String businessProfileId;
  final String requirementId;
  final String title;
  final String description;
  final TaskStage stage;
  final TaskStatus status;
  final String dueDate;

  const BusinessTaskModel({
    required this.id,
    required this.businessProfileId,
    required this.requirementId,
    required this.title,
    required this.description,
    required this.stage,
    required this.status,
    required this.dueDate,
  });

  factory BusinessTaskModel.fromJson(Map<String, dynamic> json) {
    return BusinessTaskModel(
      id: json['id'] as String? ?? '',
      businessProfileId: json['business_profile_id'] as String? ?? '',
      requirementId: json['requirement_id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      description: json['description'] as String? ?? '',
      stage: TaskStage.fromCode(json['stage'] as String? ?? 'ENTENDER'),
      status: TaskStatus.fromCode(json['status'] as String? ?? 'PENDING'),
      dueDate: json['due_date'] as String? ?? '',
    );
  }
}

@immutable
class BusinessFindingModel {
  final String id;
  final String businessProfileId;
  final String title;
  final String description;
  final FindingRiskLevel riskLevel;
  final String status;
  final String mitigationPlan;

  const BusinessFindingModel({
    required this.id,
    required this.businessProfileId,
    required this.title,
    required this.description,
    required this.riskLevel,
    required this.status,
    required this.mitigationPlan,
  });

  factory BusinessFindingModel.fromJson(Map<String, dynamic> json) {
    return BusinessFindingModel(
      id: json['id'] as String? ?? '',
      businessProfileId: json['business_profile_id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      description: json['description'] as String? ?? '',
      riskLevel: FindingRiskLevel.fromCode(json['risk_level'] as String? ?? 'MEDIUM'),
      status: json['status'] as String? ?? 'OPEN',
      mitigationPlan: json['mitigation_plan'] as String? ?? '',
    );
  }
}
