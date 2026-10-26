class ProviderModel {
  final String id, fullName, avatarUrl, businessName, description;
  final double ratingAvg, latitude, longitude;
  final int ratingCount, distanceMeters;
  final bool isVerified, isSalon;

  double get rating => ratingAvg;

  ProviderModel({
    required this.id,
    required this.fullName,
    required this.avatarUrl,
    required this.businessName,
    required this.description,
    required this.ratingAvg,
    required this.ratingCount,
    required this.isVerified,
    required this.distanceMeters,
    required this.latitude,
    required this.longitude,
    this.isSalon = false,
  });

  factory ProviderModel.fromJson(Map<String, dynamic> json) => ProviderModel(
        id: json['id'] as String? ?? '',
        fullName: json['full_name'] as String? ?? 'Sin nombre',
        avatarUrl: json['avatar_url'] as String? ?? '',
        businessName: json['business_name'] as String? ?? 'Establecimiento',
        description: json['description'] as String? ?? '',
        ratingAvg: _toSafeDouble(json['rating_avg']),
        ratingCount: _toSafeInt(json['rating_count']),
        isVerified: json['is_verified'] as bool? ?? false,
        distanceMeters: _toSafeInt(json['distance_meters']),
        latitude: _toSafeDouble(json['latitude']),
        longitude: _toSafeDouble(json['longitude']),
        isSalon: json['is_salon'] as bool? ?? false,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'full_name': fullName,
        'avatar_url': avatarUrl,
        'business_name': businessName,
        'description': description,
        'rating_avg': ratingAvg,
        'rating_count': ratingCount,
        'is_verified': isVerified,
        'distance_meters': distanceMeters,
        'latitude': latitude,
        'longitude': longitude,
        'is_salon': isSalon,
      };

  static double _toSafeDouble(v) => v == null
      ? 0.0
      : v is num
          ? v.toDouble()
          : double.tryParse(v.toString()) ?? 0.0;
  static int _toSafeInt(v) => v == null
      ? 0
      : v is num
          ? v.toInt()
          : int.tryParse(v.toString()) ?? 0;
}
