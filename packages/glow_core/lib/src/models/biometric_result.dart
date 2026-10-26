// frontend/lib/models/biometric_result.dart

class BiometricResult {
  final String? profileId;
  final FaceScores? face;
  final HandsDiagnosis? hands;
  final String? recommendation;
  final Map<String, dynamic>? vtoTones;
  final List<Product>? products;
  final int? glowScore;
  final Map<String, dynamic>? dermoFamilies;

  /// Y-F5: la medición se reutilizó de un escaneo previo con la misma foto
  /// (no se gastó una unidad del proveedor).
  final bool cacheHit;

  BiometricResult({
    this.profileId,
    this.face,
    this.hands,
    this.recommendation,
    this.vtoTones,
    this.products,
    this.glowScore,
    this.dermoFamilies,
    this.deltaVerdict,
    this.deltaGlowScore,
    this.deltaSignificant,
    this.cacheHit = false,
  });

  /// Y-F3: veredicto del cambio contra el baseline propio.
  /// Valores: MEJORO, EMPEORO, MIXTO, SIN_CAMBIO, SIN_BASELINE, NO_DISPONIBLE.
  final String? deltaVerdict;
  final double? deltaGlowScore;
  final int? deltaSignificant;

  factory BiometricResult.fromJson(Map<String, dynamic> json) {
    final data = json['results'] is Map<String, dynamic>
        ? json['results'] as Map<String, dynamic>
        : json;

    // Y-F3: bloque de comparación contra el escaneo anterior (puede no venir).
    final rawDelta = data['delta'] ?? json['delta'];
    final deltaMap = rawDelta is Map ? rawDelta : null;
    final deltaGlow = deltaMap?['glowScore'] is Map ? deltaMap!['glowScore'] as Map : null;
    final rawGlowDelta = deltaGlow?['delta'];
    final rawSignificant = deltaMap?['significant'];

    // Y-F5: si la medición vino de la caché de la misma foto.
    final rawCache = data['cache'] ?? json['cache'];
    final cacheMap = rawCache is Map ? rawCache : null;

    final rawGlowScore = json['glowScore'] ?? data['glowScore'];
    int? parsedGlowScore = (rawGlowScore is num)
        ? rawGlowScore.toInt()
        : int.tryParse(rawGlowScore?.toString() ?? '');

    final faceScores = data['face'] is Map<String, dynamic>
        ? FaceScores.fromJson(data['face'])
        : (data['faceScores'] is Map<String, dynamic>
            ? FaceScores.fromJson(data['faceScores'])
            : null);

    // Fallback formula Evimetra-style si no viene del backend
    if (parsedGlowScore == null && faceScores != null) {
      final h = faceScores.hydration;
      final c = 100 - faceScores.spots;
      final t = 100 - faceScores.pores;
      final f = 100 - faceScores.wrinkles;
      parsedGlowScore = ((h * 0.35) + (c * 0.25) + (t * 0.25) + (f * 0.15)).round().clamp(0, 100);
    }

    return BiometricResult(
      profileId: json['profileId']?.toString() ?? data['profileId']?.toString(),
      face: faceScores,
      hands: data['hands'] is Map<String, dynamic> ? HandsDiagnosis.fromJson(data['hands']) : null,
      recommendation: (data['recommendation'] ?? json['recommendation'])?.toString(),
      vtoTones: data['vtoTones'] is Map<String, dynamic> ? data['vtoTones'] as Map<String, dynamic> : null,
      products: data['products'] is List
          ? (data['products'] as List).whereType<Map<String, dynamic>>().map((p) => Product.fromJson(p)).toList()
          : null,
      glowScore: parsedGlowScore,
      dermoFamilies: (json['dermoFamilies'] is Map<String, dynamic>)
          ? json['dermoFamilies'] as Map<String, dynamic>
          : (data['dermoFamilies'] is Map<String, dynamic>
              ? data['dermoFamilies'] as Map<String, dynamic>
              : null),
      deltaVerdict: deltaMap?['verdict']?.toString(),
      deltaGlowScore: rawGlowDelta is num
          ? rawGlowDelta.toDouble()
          : double.tryParse(rawGlowDelta?.toString() ?? ''),
      deltaSignificant: rawSignificant is num
          ? rawSignificant.toInt()
          : int.tryParse(rawSignificant?.toString() ?? ''),
      cacheHit: cacheMap?['hit'] == true,
    );
  }
}

class FaceScores {
  final int hydration;
  final int wrinkles;
  final int spots;
  final int pores;
  final String subtono;
  final int bioAge;
  /// Y-F2: tipo de piel medido por YouCam (hd_skin_type). Antes se publicaba como
  /// subtono; ahora viaja aparte.
  final String? pielTipo;
  /// 'ita_hue_propio' si el subtono se midió sobre la foto; 'no_medido' si no.
  final String? subtonoFuente;

  FaceScores({
    required this.hydration,
    required this.wrinkles,
    required this.spots,
    required this.pores,
    required this.subtono,
    required this.bioAge,
    this.pielTipo,
    this.subtonoFuente,
  });

  /// Un subtono vacío significa que no se midió: no se inventa 'neutro'.
  bool get subtonoMedido => subtono.isNotEmpty;

  factory FaceScores.fromJson(Map<String, dynamic> json) {
    return FaceScores(
      hydration: (json['hydration'] is num) ? (json['hydration'] as num).toInt() : (int.tryParse(json['hydration']?.toString() ?? '') ?? 0),
      wrinkles: (json['wrinkles'] is num) ? (json['wrinkles'] as num).toInt() : (int.tryParse(json['wrinkles']?.toString() ?? '') ?? 0),
      spots: (json['spots'] is num) ? (json['spots'] as num).toInt() : (int.tryParse(json['spots']?.toString() ?? '') ?? 0),
      pores: (json['pores'] is num) ? (json['pores'] as num).toInt() : (int.tryParse(json['pores']?.toString() ?? '') ?? 0),
      subtono: json['subtono']?.toString() ?? '',
      bioAge: (json['bioAge'] is num) ? (json['bioAge'] as num).toInt() : (int.tryParse(json['bioAge']?.toString() ?? '') ?? 30),
      pielTipo: json['pielTipo']?.toString(),
      subtonoFuente: json['subtonoFuente']?.toString(),
    );
  }
}

class HandsDiagnosis {
  final String manchasSolares;
  final String sequedad;
  final String cuticulas;
  final String unas;
  final int edadAparente;

  HandsDiagnosis({
    required this.manchasSolares,
    required this.sequedad,
    required this.cuticulas,
    required this.unas,
    required this.edadAparente,
  });

  factory HandsDiagnosis.fromJson(Map<String, dynamic> json) {
    final rawEdad = json['edadAparente'] ?? json['edad_aparente'];
    return HandsDiagnosis(
      manchasSolares: (json['manchasSolares'] ?? json['manchas_solares'])?.toString() ?? 'leve',
      sequedad: json['sequedad']?.toString() ?? 'leve',
      cuticulas: json['cuticulas']?.toString() ?? 'sanas',
      unas: (json['unas'] ?? json['uñas'])?.toString() ?? 'sanas',
      edadAparente: (rawEdad is num) ? rawEdad.toInt() : (int.tryParse(rawEdad?.toString() ?? '') ?? 30),
    );
  }
}

class Product {
  final String name;
  final String brand;
  final String imageUrl;
  final String price;
  final bool compatible;

  Product({
    required this.name,
    required this.brand,
    required this.imageUrl,
    required this.price,
    this.compatible = false,
  });

  factory Product.fromJson(Map<String, dynamic> json) {
    return Product(
      name: json['name'] ?? 'Producto',
      brand: json['brand'] ?? 'Marca',
      imageUrl: json['image'] ?? '',
      price: json['price'] ?? '\$',
      compatible: json['compatible'] ?? false,
    );
  }
}

class ProductDetail {
  final String barcode;
  final String name;
  final String brand;
  final String imageUrl;
  final String ingredients;
  final String categories;
  final String price;
  final bool compatible;
  final String compatibilityReason;

  ProductDetail({
    required this.barcode,
    required this.name,
    required this.brand,
    this.imageUrl = '',
    this.ingredients = '',
    this.categories = '',
    this.price = '',
    this.compatible = false,
    this.compatibilityReason = '',
  });

  factory ProductDetail.fromJson(Map<String, dynamic> json) {
    return ProductDetail(
      barcode: json['barcode'] ?? '',
      name: json['name'] ?? 'Producto',
      brand: json['brand'] ?? 'Marca',
      imageUrl: json['image'] ?? json['imageUrl'] ?? '',
      ingredients: json['ingredients'] ?? '',
      categories: json['categories'] ?? '',
      price: json['price'] ?? '',
      compatible: json['compatible'] ?? false,
      compatibilityReason: json['compatibilityReason'] ?? '',
    );
  }
}
