// frontend/lib/widgets/product_quick_view_dialog.dart
import 'package:flutter/material.dart';
import '../shared/theme.dart';

class ProductQuickViewDialog extends StatefulWidget {
  final Map<String, dynamic> product;
  final String? bookingId;
  final Function(Map<String, dynamic> prod, int qty) onAddToCart;

  const ProductQuickViewDialog({
    super.key,
    required this.product,
    this.bookingId,
    required this.onAddToCart,
  });

  @override
  State<ProductQuickViewDialog> createState() => _ProductQuickViewDialogState();
}

class _ProductQuickViewDialogState extends State<ProductQuickViewDialog> {
  int _qty = 1;
  String _selectedSkinTone = 'Piel Clara';

  String _formatCOP(double amount) {
    return '\$${amount.toStringAsFixed(0).replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (Match m) => '${m[1]}.')} COP';
  }

  Widget _buildSkinToneChip(String label, Color color) {
    final isSelected = _selectedSkinTone == label;
    return GestureDetector(
      onTap: () => setState(() => _selectedSkinTone = label),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: color.withOpacity(0.3),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isSelected ? AppTheme.primary : Colors.transparent,
            width: 2,
          ),
        ),
        child: Row(
          children: [
            CircleAvatar(radius: 6, backgroundColor: color),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                color: AppTheme.text,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPlaceholderImage(double height) {
    return Container(
      height: height,
      color: Colors.grey.shade100,
      width: double.infinity,
      child: const Icon(Icons.image, size: 50, color: Colors.grey),
    );
  }

  @override
  Widget build(BuildContext context) {
    final price = double.tryParse(widget.product['precio']?.toString() ?? '0') ?? 0.0;
    final stock = widget.product['stock'] as int? ?? 0;
    final imageUrl = widget.product['imagen_url']?.toString() ?? '';

    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      clipBehavior: Clip.antiAlias,
      backgroundColor: Colors.white,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 550),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Encabezado con imagen
              Stack(
                children: [
                  imageUrl.isNotEmpty
                      ? Hero(
                          tag: 'product_hero_${widget.product['id']}',
                          child: Image.network(
                            imageUrl,
                            height: 250,
                            width: double.infinity,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => _buildPlaceholderImage(250),
                          ),
                        )
                      : _buildPlaceholderImage(250),
                  Positioned(
                    top: 12,
                    right: 12,
                    child: CircleAvatar(
                      backgroundColor: Colors.white.withOpacity(0.9),
                      child: IconButton(
                        icon: const Icon(Icons.close, color: AppTheme.text),
                        onPressed: () => Navigator.pop(context),
                      ),
                    ),
                  ),
                  // Badge de Visibilidad del Producto
                  Positioned(
                    top: 12,
                    left: 12,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: (widget.product['tipo_visibilidad'] == 'INSUMO_PRESTADOR')
                            ? const Color(0xFFDC2626) // Rojo elegante para Insumos
                            : const Color(0xFF059669), // Verde esmeralda para Público
                        borderRadius: BorderRadius.circular(8),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.1),
                            blurRadius: 4,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                      child: Text(
                        (widget.product['tipo_visibilidad'] == 'INSUMO_PRESTADOR')
                            ? 'PROFESIONAL / INSUMO'
                            : 'VENTA AL PÚBLICO',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              Padding(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppTheme.primary.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        widget.product['tag_especialidad']?.toString() ?? 'Especialidad',
                        style: const TextStyle(
                          color: AppTheme.primary,
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      widget.product['nombre']?.toString() ?? 'Producto',
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.text,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      widget.product['marca']?.toString() ?? 'GlowStore',
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppTheme.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 16),
                    // SELECTOR DE MUESTRA SEGÚN FOTOTIPO DE PIEL (UX BELLEZA - SWATCHES)
                    const Text(
                      'Muestra Aplicada por Fototipo de Piel',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.text,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        _buildSkinToneChip('Piel Clara', const Color(0xFFF3E5DC)),
                        const SizedBox(width: 8),
                        _buildSkinToneChip('Trigueña', const Color(0xFFD8B094)),
                        const SizedBox(width: 8),
                        _buildSkinToneChip('Morena', const Color(0xFF8D5B4C)),
                      ],
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'Descripción del Producto',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.text,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      widget.product['descripcion']?.toString() ?? 'Sin descripción disponible.',
                      style: TextStyle(
                        fontSize: 13,
                        color: AppTheme.text.withOpacity(0.8),
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Builder(
                      builder: (context) {
                        if (widget.bookingId != null && widget.product.containsKey('precio_con_reserva')) {
                          final originalPrice = double.tryParse(widget.product['precio']?.toString() ?? '0') ?? 0.0;
                          final discountPrice = double.tryParse(widget.product['precio_con_reserva']?.toString() ?? '0') ?? 0.0;
                          return Row(
                            children: [
                              Text(
                                _formatCOP(originalPrice),
                                style: const TextStyle(
                                  fontSize: 14,
                                  color: Colors.grey,
                                  decoration: TextDecoration.lineThrough,
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text(
                                _formatCOP(discountPrice),
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w700,
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
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            color: AppTheme.primary,
                          ),
                        );
                      },
                    ),
                    const SizedBox(height: 16),
                    const Divider(),
                    const SizedBox(height: 8),
                    const Text(
                      'Descripción',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 14,
                        color: AppTheme.text,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      widget.product['descripcion']?.toString() ?? 'Sin descripción disponible.',
                      style: TextStyle(
                        fontSize: 13,
                        color: AppTheme.text.withOpacity(0.8),
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Stock disponible: $stock unidades',
                          style: TextStyle(
                            fontSize: 12,
                            color: stock > 0 ? Colors.green : Colors.red,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    if (stock > 0)
                      Row(
                        children: [
                          // Selector de Cantidad
                          Container(
                            decoration: BoxDecoration(
                              border: Border.all(color: Colors.grey.shade300),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Row(
                              children: [
                                IconButton(
                                  icon: const Icon(Icons.remove, size: 18),
                                  onPressed: _qty > 1
                                      ? () => setState(() => _qty--)
                                      : null,
                                ),
                                Text(
                                  '$_qty',
                                  style: const TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                IconButton(
                                  icon: const Icon(Icons.add, size: 18),
                                  onPressed: _qty < stock
                                      ? () => setState(() => _qty++)
                                      : null,
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 16),
                          // Botón Añadir
                          Expanded(
                            child: ElevatedButton(
                              onPressed: () {
                                Navigator.pop(context);
                                widget.onAddToCart(widget.product, _qty);
                              },
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppTheme.primary,
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(vertical: 16),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12),
                                ),
                              ),
                              child: const Text(
                                'Añadir al Carrito',
                                style: TextStyle(fontWeight: FontWeight.bold),
                              ),
                            ),
                          ),
                        ],
                      )
                    else
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: Colors.red.shade50,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Text(
                          'Agotado temporalmente',
                          style: TextStyle(
                            color: Colors.red,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
