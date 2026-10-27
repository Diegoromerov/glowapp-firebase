// frontend/lib/screens/ideas/product_scanner_screen.dart
import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:cached_network_image/cached_network_image.dart';

class ProductScannerScreen extends StatefulWidget {
  const ProductScannerScreen({super.key});

  @override
  State<ProductScannerScreen> createState() => _ProductScannerScreenState();
}

class _ProductScannerScreenState extends State<ProductScannerScreen> {
  bool _isScanning = true;
  bool _isProcessing = false;
  ProductDetail? _scannedProduct;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: Text(
                  'Escanear Producto',
                  style: TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontWeight: FontWeight.bold,
                    fontSize: 22,
                    color: AppTheme.text,
                  ),
                ),
                backgroundColor: AppTheme.background,
                elevation: 0,
                iconTheme: IconThemeData(color: AppTheme.text),
              ),
      body: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 580),
                child: _isProcessing
                    ? Center(child: CircularProgressIndicator(color: AppTheme.primary))
                    : _scannedProduct != null
                        ? _buildResultView()
                  : MobileScanner(
                      onDetect: (capture) async {
                        if (_isScanning) {
                          final barcode = capture.barcodes.first.rawValue;
                          if (barcode != null) {
                            setState(() {
                              _isScanning = false;
                              _isProcessing = true;
                            });
                            await _checkProduct(barcode);
                          }
                        }
                      },
                    ),
        ),
      ),
    );
  }

  Future<void> _checkProduct(String barcode) async {
    try {
      final product = await BiometricService.checkProduct(barcode);
      if (!mounted) return;
      setState(() {
        _scannedProduct = product;
        _isProcessing = false;
      });
    } catch (e) {
      setState(() {
        _isProcessing = false;
        _scannedProduct = null;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Producto no encontrado o error al verificar.'),
          ),
        );
        Navigator.pop(context);
      }
    }
  }

  Widget _buildResultView() {
    final product = _scannedProduct!;
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Resultado del producto',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Row(
                    children: [
                      Container(
                        width: 80,
                        height: 80,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(8),
                          color: Colors.grey[200],
                        ),
                        child: product.imageUrl.isNotEmpty
                            ? CachedNetworkImage(
                                imageUrl: product.imageUrl,
                                width: 80,
                                height: 80,
                                fit: BoxFit.cover,
                                placeholder: (context, url) => const Center(
                                  child: SizedBox(
                                    width: 24,
                                    height: 24,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  ),
                                ),
                                errorWidget: (context, url, error) => const Icon(Icons.photo, size: 40, color: Colors.grey),
                              )
                            : const Icon(Icons.photo, size: 40, color: Colors.grey),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              product.name,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            Text(
                              product.brand,
                              style: TextStyle(color: Colors.grey[600]),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: product.compatible
                          ? Colors.green.withValues(alpha: 0.1)
                          : Colors.orange.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          product.compatible ? Icons.check_circle : Icons.warning,
                          color: product.compatible ? Colors.green : Colors.orange,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            product.compatibilityReason.isNotEmpty
                                ? product.compatibilityReason
                                : (product.compatible
                                    ? 'Este producto es compatible con tu perfil.'
                                    : 'Este producto podria no ser el mas adecuado para ti.'),
                            style: TextStyle(
                              fontSize: 14,
                              color: product.compatible ? Colors.green[800] : Colors.orange[800],
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
          const Spacer(),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () {
                    setState(() {
                      _scannedProduct = null;
                      _isScanning = true;
                    });
                  },
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.text,
                    side: BorderSide(color: AppTheme.primary.withValues(alpha: 0.3)),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                  ),
                  child: const Text('Escanear otro', style: TextStyle(fontFamily: 'Inter')),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Container(
                  height: 48,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    gradient: const LinearGradient(
                      colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: const Color(0xFFC5A052).withValues(alpha: 0.35),
                        blurRadius: 8,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  child: ElevatedButton(
                    onPressed: () => Navigator.pop(context),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.transparent,
                      shadowColor: Colors.transparent,
                      foregroundColor: AppTheme.text,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                    child: const Text('Listo', style: TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.bold)),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
