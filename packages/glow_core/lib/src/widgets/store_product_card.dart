import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:shimmer/shimmer.dart';
import '../services/api_service.dart';
import '../shared/theme.dart';
import '../shared/currency_formatter.dart';

class StoreProductCard extends StatelessWidget {
  final Map<String, dynamic> product;
  final String? bookingId;
  final VoidCallback onQuickViewPressed;
  final Function(Map<String, dynamic> prod) onAddToCart;

  const StoreProductCard({
    super.key,
    required this.product,
    this.bookingId,
    required this.onQuickViewPressed,
    required this.onAddToCart,
  });

  String _formatCOP(double amount) {
    return CurrencyFormatter.formatCOP(amount);
  }

  Widget _buildPlaceholderImage() {
    return Container(
      color: Colors.grey.shade100,
      width: double.infinity,
      height: double.infinity,
      child: const Icon(Icons.image, size: 50, color: Colors.grey),
    );
  }

  @override
  Widget build(BuildContext context) {
    final price = double.tryParse(product['precio']?.toString() ?? '0') ?? 0.0;
    final stock = product['stock'] as int? ?? 0;
    final imageUrl = product['imagen_url']?.toString() ?? '';

    final isDark = MapSettings.isDark;
    final cardBg = isDark ? const Color(0xFF24232B) : Colors.white;
    final borderColor = isDark ? const Color(0xFF33313D) : Colors.grey.shade100;
    final textColor = isDark ? Colors.white : AppTheme.text;

    return Container(
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderColor, width: 1.5),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Imagen con hover zoom y Quick View
          Expanded(
            child: Stack(
              children: [
                imageUrl.isNotEmpty
                    ? Hero(
                        tag: 'product_hero_${product['id']}',
                        child: CachedNetworkImage(
                          imageUrl: imageUrl,
                          width: double.infinity,
                          height: double.infinity,
                          fit: BoxFit.cover,
                          placeholder: (context, url) => Shimmer.fromColors(
                            baseColor: Colors.grey.shade300,
                            highlightColor: Colors.grey.shade100,
                            child: Container(color: Colors.white),
                          ),
                          errorWidget: (context, url, error) => _buildPlaceholderImage(),
                        ),
                      )
                    : _buildPlaceholderImage(),
                // Botón Vista Rápida
                Positioned(
                  bottom: 8,
                  left: 8,
                  right: 8,
                  child: Opacity(
                    opacity: 0.9,
                    child: ElevatedButton(
                      onPressed: onQuickViewPressed,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: AppTheme.text,
                        minimumSize: const Size(0, 36),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                      ),
                      child: const Text('Vista Rápida', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                    ),
                  ),
                ),
                // Badge de Visibilidad del Producto
                Positioned(
                  top: 8,
                  left: 8,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: (product['tipo_visibilidad'] == 'INSUMO_PRESTADOR')
                          ? const Color(0xFFDC2626) // Rojo elegante para Insumos
                          : const Color(0xFF059669), // Verde esmeralda para Público
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      (product['tipo_visibilidad'] == 'INSUMO_PRESTADOR')
                          ? 'PROFESIONAL'
                          : 'PÚBLICO',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 8,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  product['tag_especialidad']?.toString().toUpperCase() ?? 'COSMÉTICOS',
                  style: const TextStyle(
                    color: Colors.grey,
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1.1,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  product['nombre']?.toString() ?? 'Producto',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: textColor,
                  ),
                ),
                const SizedBox(height: 4),
                // Calificación Ficticia (Shopify Stars)
                Row(
                  children: List.generate(5, (starIdx) {
                    return const Icon(Icons.star, color: Colors.amber, size: 12);
                  }),
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Builder(
                          builder: (context) {
                            if (bookingId != null && product.containsKey('precio_con_reserva')) {
                              final originalPrice = double.tryParse(product['precio']?.toString() ?? '0') ?? 0.0;
                              final discountPrice = double.tryParse(product['precio_con_reserva']?.toString() ?? '0') ?? 0.0;
                              return Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    _formatCOP(originalPrice),
                                    style: const TextStyle(
                                      fontSize: 10,
                                      color: Colors.grey,
                                      decoration: TextDecoration.lineThrough,
                                    ),
                                  ),
                                  Text(
                                    _formatCOP(discountPrice),
                                    style: const TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.bold,
                                      color: AppTheme.primary,
                                    ),
                                  ),
                                ],
                              );
                            }
                            final priceWithIva = price * 1.19;
                            return Text(
                              _formatCOP(priceWithIva),
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.primary,
                              ),
                            );
                          },
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    if (stock > 0)
                      Semantics(
                        button: true,
                        label: 'Añadir ${product['nombre'] ?? 'producto'} al carrito',
                        hint: 'Toca para agregar una unidad de este producto a tu pedido',
                        child: InkWell(
                          onTap: () {
                            HapticFeedback.lightImpact();
                            onAddToCart(product);
                          },
                          borderRadius: BorderRadius.circular(19),
                          child: Container(
                            width: 38,
                            height: 38,
                            decoration: BoxDecoration(
                              color: AppTheme.primary.withOpacity(0.10),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            alignment: Alignment.center,
                            child: const Icon(Icons.add_shopping_cart, color: AppTheme.primary, size: 20),
                          ),
                        ),
                      )
                    else
                      const Text(
                        'Agotado',
                        style: TextStyle(color: Colors.red, fontSize: 11, fontWeight: FontWeight.bold),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
