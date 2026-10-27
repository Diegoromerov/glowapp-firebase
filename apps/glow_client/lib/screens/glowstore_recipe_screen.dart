import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
/// Modelo local para los productos recomendados en la receta de GlowStore.
class RecipeProduct {
  final String id;
  final String title;
  final String category;
  final String price;
  final Color accentColor;
  final IconData icon;

  const RecipeProduct({
    required this.id,
    required this.title,
    required this.category,
    required this.price,
    required this.accentColor,
    required this.icon,
  });
}

/// Pantalla de Receta Personalizada e Integración con GlowStore.
/// Muestra un carrusel en scroll horizontal con productos recomendados específicamente
/// para el ADN cromático del usuario (subtono cálido / otoño).
class GlowstoreRecipeScreen extends StatefulWidget {
  final Function(RecipeProduct product)? onAddToCart;
  final VoidCallback? onCheckout;

  const GlowstoreRecipeScreen({
    super.key,
    this.onAddToCart,
    this.onCheckout,
  });

  @override
  State<GlowstoreRecipeScreen> createState() => _GlowstoreRecipeScreenState();
}

class _GlowstoreRecipeScreenState extends State<GlowstoreRecipeScreen> {
  final Set<String> _cartProductIds = {};

  static const List<RecipeProduct> _recommendedProducts = [
    RecipeProduct(
      id: 'prod_1',
      title: 'Sérum Óleo Terracota Facial',
      category: 'Tratamiento de Piel',
      price: '\$89.900 COP',
      accentColor: GlowTokens.terracota,
      icon: Icons.water_drop_rounded,
    ),
    RecipeProduct(
      id: 'prod_2',
      title: 'Labial Matte Rose Gold',
      category: 'Cosméticos Labiales',
      price: '\$54.000 COP',
      accentColor: GlowTokens.roseGold,
      icon: Icons.brush_rounded,
    ),
    RecipeProduct(
      id: 'prod_3',
      title: 'Mascarilla Ámbar Nutritiva',
      category: 'Cuidado Capilar',
      price: '\$68.500 COP',
      accentColor: GlowTokens.amber,
      icon: Icons.spa_rounded,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        title: const Text(
          'Receta GlowStore',
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontWeight: FontWeight.bold,
            fontSize: 22,
            color: Color(0xFF1F1A15),
          ),
        ),
        backgroundColor: const Color(0xFFFAF8F5),
        elevation: 0,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 12),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 20.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Tu Receta de Belleza',
                        style: TextStyle(
                          fontFamily: 'CormorantGaramond',
                          fontSize: 26,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF1F1A15),
                        ),
                      ),
                      SizedBox(height: 4),
                      Text(
                        'Selección exclusiva formulada para potenciar tu subtono cálido.',
                        style: TextStyle(
                          fontFamily: 'Inter',
                          fontSize: 14,
                          color: Color(0xFF6B5E59),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),

            // Carrusel Horizontal de Productos
            SizedBox(
              height: 380,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16.0),
                itemCount: _recommendedProducts.length,
                itemBuilder: (context, index) {
                  final product = _recommendedProducts[index];
                  final isInCart = _cartProductIds.contains(product.id);

                  return Container(
                    width: 260,
                    margin: const EdgeInsets.symmetric(horizontal: 8.0),
                    child: GlowGlassCard(
                      borderRadius: 24,
                      padding: const EdgeInsets.all(20.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Cabecera con Icono y Categoría
                          Container(
                            height: 110,
                            decoration: BoxDecoration(
                              color: product.accentColor.withValues(alpha: 0.25),
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: Center(
                              child: Icon(
                                product.icon,
                                size: 52,
                                color: product.accentColor,
                              ),
                            ),
                          ),
                          const SizedBox(height: 16),
                          Text(
                            product.category.toUpperCase(),
                            style: const TextStyle(
                              fontFamily: GlowTokens.fontJetBrainsMono,
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: GlowTokens.terracota,
                              letterSpacing: 1.2,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            product.title,
                            style: const TextStyle(
                              fontFamily: GlowTokens.fontPlayfairDisplay,
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              color: GlowTokens.nightAndean,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const Spacer(),
                          Text(
                            product.price,
                            style: const TextStyle(
                              fontFamily: GlowTokens.fontInter,
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              color: GlowTokens.nightAndean,
                            ),
                          ),
                          const SizedBox(height: 12),

                          // Botón Añadir al Carrito
                          SizedBox(
                            width: double.infinity,
                            child: ElevatedButton(
                              onPressed: () {
                                setState(() {
                                  if (isInCart) {
                                    _cartProductIds.remove(product.id);
                                  } else {
                                    _cartProductIds.add(product.id);
                                  }
                                });
                                widget.onAddToCart?.call(product);
                              },
                              style: ElevatedButton.styleFrom(
                                backgroundColor: isInCart
                                    ? GlowTokens.emerald
                                    : GlowTokens.terracota,
                                padding: const EdgeInsets.symmetric(vertical: 12),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(
                                    isInCart
                                        ? Icons.check_circle_rounded
                                        : Icons.add_shopping_cart_rounded,
                                    size: 18,
                                  ),
                                  const SizedBox(width: 8),
                                  Text(
                                    isInCart ? 'Añadido' : 'Añadir al Carrito',
                                    style: const TextStyle(fontSize: 14),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),

            const Spacer(),

            // Botón de Checkout General
            Padding(
              padding: const EdgeInsets.all(20.0),
              child: Container(
                height: 52,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(16),
                  gradient: _cartProductIds.isNotEmpty
                      ? const LinearGradient(
                          colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        )
                      : null,
                  color: _cartProductIds.isEmpty ? const Color(0xFFE8DFD8) : null,
                  boxShadow: _cartProductIds.isNotEmpty
                      ? [
                          BoxShadow(
                            color: const Color(0xFFC5A052).withValues(alpha: 0.35),
                            blurRadius: 10,
                            offset: const Offset(0, 4),
                          ),
                        ]
                      : null,
                ),
                child: ElevatedButton(
                  onPressed: _cartProductIds.isNotEmpty ? widget.onCheckout : null,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.transparent,
                    shadowColor: Colors.transparent,
                    foregroundColor: const Color(0xFF1F1A15),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  child: Text(
                    _cartProductIds.isNotEmpty
                        ? 'Finalizar Compra (${_cartProductIds.length})'
                        : 'Selecciona tus productos',
                    style: TextStyle(
                      fontFamily: 'Inter',
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: _cartProductIds.isNotEmpty ? const Color(0xFF1F1A15) : const Color(0xFF8E7D7A),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  ),
);
  }
}
