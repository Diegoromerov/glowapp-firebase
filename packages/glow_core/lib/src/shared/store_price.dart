/// Precio final que debe mostrarse en las vitrinas, vista rápida y carrito.
///
/// El backend entrega `precio` antes de IVA cuando la lista no lo incluye y
/// como precio final cuando `incluye_iva` es true. Si no llega ese indicador
/// (respuesta de un backend anterior), se conserva el comportamiento de vitrina
/// y se trata el precio como base gravable.
class StorePrice {
  static const double ivaRate = 0.19;

  static double finalPrice(
    Map<String, dynamic> product, {
    String? bookingId,
  }) {
    final source = bookingId != null && product['precio_con_reserva'] != null
        ? product['precio_con_reserva']
        : product['precio'];
    final price = double.tryParse(source?.toString() ?? '0') ?? 0;
    return product['incluye_iva'] == true ? price : price * (1 + ivaRate);
  }
}
