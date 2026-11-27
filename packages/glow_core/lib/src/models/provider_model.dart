class ProviderModel {
  final String id, fullName, avatarUrl, businessName, description;
  final double ratingAvg, latitude, longitude;
  final int ratingCount, distanceMeters;
  final bool isVerified, isSalon;
  final bool _reportedLiveLocation;
  final DateTime? liveLocationUpdatedAt;
  final double? registeredLatitude, registeredLongitude;

  /// El backend solo lo activa cuando la cuenta está operativa y tiene oferta reservable.
  final bool canReceiveBookings;

  /// Primer hueco libre HOY ('HH:MM'), o null si no le queda agenda.
  /// Lo calcula el backend con el horario del prestador y sus reservas.
  final String? nextSlotToday;
  final bool availableToday;

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
    this.canReceiveBookings = false,
    this.nextSlotToday,
    this.availableToday = false,
    bool isLiveLocation = false,
    this.liveLocationUpdatedAt,
    this.registeredLatitude,
    this.registeredLongitude,
  }) : _reportedLiveLocation = isLiveLocation;

  /// Solo se presenta como ubicación en vivo durante los cinco minutos en los
  /// que el backend considera vigente una captura.
  bool get isLiveLocation {
    final capturedAt = liveLocationUpdatedAt;
    if (!_reportedLiveLocation || capturedAt == null) return false;
    final age = DateTime.now().toUtc().difference(capturedAt.toUtc());
    return age >= const Duration(seconds: -30) &&
        age <= const Duration(minutes: 5);
  }

  double get mapLatitude =>
      isLiveLocation ? latitude : registeredLatitude ?? latitude;
  double get mapLongitude =>
      isLiveLocation ? longitude : registeredLongitude ?? longitude;

  bool get hasMapCoordinate {
    if (!latitude.isFinite || !longitude.isFinite) return false;
    if (isLiveLocation) return true;
    if (_reportedLiveLocation &&
        (registeredLatitude == null || registeredLongitude == null)) {
      return false;
    }
    return (registeredLatitude ?? latitude).isFinite &&
        (registeredLongitude ?? longitude).isFinite;
  }

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
        canReceiveBookings: json['can_receive_bookings'] as bool? ?? false,
        nextSlotToday: json['next_slot_today'] as String?,
        availableToday: json['available_today'] as bool? ?? false,
        isLiveLocation: json['is_live_location'] == true,
        liveLocationUpdatedAt: DateTime.tryParse(
          json['live_location_updated_at']?.toString() ?? '',
        ),
        registeredLatitude: json['registered_latitude'] == null
            ? null
            : _toSafeDouble(json['registered_latitude']),
        registeredLongitude: json['registered_longitude'] == null
            ? null
            : _toSafeDouble(json['registered_longitude']),
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
        'can_receive_bookings': canReceiveBookings,
        'is_live_location': _reportedLiveLocation,
        'live_location_updated_at':
            liveLocationUpdatedAt?.toUtc().toIso8601String(),
        'registered_latitude': registeredLatitude,
        'registered_longitude': registeredLongitude,
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
