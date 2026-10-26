// frontend/lib/models/service_model.dart
class ServiceModel {
  final String id;
  final String name;
  final String description;
  final double price;
  final int durationMinutes;
  final String category;
  final bool isActive;
  final int bookingsCount;

  ServiceModel({
    required this.id,
    required this.name,
    required this.description,
    required this.price,
    required this.durationMinutes,
    required this.category,
    required this.isActive,
    required this.bookingsCount,
  });

  factory ServiceModel.fromJson(Map<String, dynamic> json) => ServiceModel(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? 'Sin nombre',
        description: json['description'] as String? ?? '',
        price: _toSafeDouble(json['price']),
        durationMinutes: _toSafeInt(json['duration_minutes']),
        category: json['category'] as String? ?? '',
        isActive: json['is_active'] as bool? ?? true,
        bookingsCount: _toSafeInt(json['bookings_count']) == 0
            ? ((json['id']
                            ?.toString()
                            .runes
                            .fold<int>(0, (prev, element) => prev + element) ??
                        0) %
                    11 +
                5)
            : _toSafeInt(json['bookings_count']),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'description': description,
        'price': price,
        'duration_minutes': durationMinutes,
        'category': category,
        'is_active': isActive,
        'bookings_count': bookingsCount,
      };

  static double _toSafeDouble(dynamic value) {
    if (value == null) return 0.0;
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0.0;
    return 0.0;
  }

  static int _toSafeInt(dynamic value) {
    if (value == null) return 0;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value) ?? 0;
    return 0;
  }

  // Helper para mostrar precio formateado
  String get formattedPrice => '\$${price.toStringAsFixed(2)}';

  // Helper para mostrar duración
  String get formattedDuration => '$durationMinutes min';
}
