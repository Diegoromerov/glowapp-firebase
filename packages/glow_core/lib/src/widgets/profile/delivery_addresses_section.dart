// lib/widgets/profile/delivery_addresses_section.dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../core/theme/belleza_luxe_theme.dart';
import '../../services/api_service.dart';
import 'colombian_address_builder.dart';

/// Sección reutilizable de direcciones de entrega (estructura colombiana).
///
/// Se monta tanto en "Mi Perfil Concierge" como en Configuración & Privacidad.
/// Lee y escribe contra `/api/users/delivery-addresses`.
class DeliveryAddressesSection extends StatefulWidget {
  const DeliveryAddressesSection({super.key});

  @override
  State<DeliveryAddressesSection> createState() =>
      _DeliveryAddressesSectionState();
}

class _DeliveryAddressesSectionState extends State<DeliveryAddressesSection> {
  Future<List<dynamic>> _fetchDeliveryAddresses() async {
    try {
      final headers = await ApiService.getAuthHeaders();
      final uri = Uri.parse('${ApiService.baseUrl}/api/users/delivery-addresses');
      final response =
          await http.get(uri, headers: headers).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        return data['data'] ?? [];
      }
      throw Exception('Error ${response.statusCode}');
    } catch (e) {
      throw Exception('Error de conexión: $e');
    }
  }

  Future<void> _showAddressBuilder({Map<String, dynamic>? addressToEdit}) async {
    await showColombianAddressBuilder(
      context: context,
      initialAddress: addressToEdit,
      onSave: (addressData) async {
        try {
          final headers = await ApiService.getAuthHeaders();
          final uri = addressToEdit != null
              ? Uri.parse(
                  '${ApiService.baseUrl}/api/users/delivery-addresses/${addressToEdit['id']}')
              : Uri.parse('${ApiService.baseUrl}/api/users/delivery-addresses');

          final request = addressToEdit != null
              ? await http.patch(uri, headers: headers, body: json.encode(addressData))
              : await http.post(uri, headers: headers, body: json.encode(addressData));

          if (request.statusCode == 200 || request.statusCode == 201) {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(addressToEdit != null
                      ? 'Dirección actualizada correctamente'
                      : 'Dirección guardada correctamente'),
                  backgroundColor: LuxeColors.nude900,
                ),
              );
              setState(() {});
            }
          } else {
            final errorData = json.decode(request.body);
            throw Exception(errorData['error'] ?? 'Error al guardar');
          }
        } catch (e) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Error: $e'),
                backgroundColor: const Color(0xFFB00020),
              ),
            );
          }
        }
      },
    );
  }

  String _buildFormattedAddress(Map<String, dynamic> addr) {
    final parts = <String>[];
    if (addr['tipo_via'] != null) parts.add(addr['tipo_via']);
    if (addr['numero_principal'] != null) {
      parts.add(addr['numero_principal'].toString());
    }
    if (addr['letra_principal'] != null && addr['letra_principal'].isNotEmpty) {
      parts.add(addr['letra_principal']);
    }
    if (addr['numero_secundario'] != null && addr['numero_secundario'].isNotEmpty) {
      String cruce = '#${addr['numero_secundario']}';
      if (addr['letra_secundaria'] != null && addr['letra_secundaria'].isNotEmpty) {
        cruce += '-${addr['letra_secundaria']}';
      }
      parts.add(cruce);
    }
    if (addr['complemento'] != null && addr['complemento'].isNotEmpty) {
      parts.add(addr['complemento']);
    }
    if (addr['barrio'] != null && addr['barrio'].isNotEmpty) parts.add(addr['barrio']);
    if (addr['ciudad'] != null) parts.add(addr['ciudad']);
    if (addr['departamento'] != null) parts.add(addr['departamento']);
    return parts.join(', ');
  }

  Future<void> _setDefaultAddress(String addressId) async {
    try {
      final headers = await ApiService.getAuthHeaders();
      final uri = Uri.parse(
          '${ApiService.baseUrl}/api/users/delivery-addresses/$addressId/set-default');
      final response = await http.patch(uri, headers: headers).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Dirección establecida como predeterminada'),
              backgroundColor: LuxeColors.nude900,
            ),
          );
          setState(() {});
        }
      } else {
        throw Exception('Error al establecer por defecto');
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: const Color(0xFFB00020)),
        );
      }
    }
  }

  Future<void> _deleteAddress(String addressId) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: LuxeColors.nude100,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: LuxeColors.nude200),
        ),
        title: const Text('Eliminar dirección',
            style: TextStyle(fontFamily: 'Didot', color: LuxeColors.nude900)),
        content: const Text('¿Seguro que quieres eliminar esta dirección?',
            style: TextStyle(color: LuxeColors.nude700)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar', style: TextStyle(color: LuxeColors.nude700)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Eliminar',
                style: TextStyle(color: Color(0xFFB00020), fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    try {
      final headers = await ApiService.getAuthHeaders();
      final uri = Uri.parse('${ApiService.baseUrl}/api/users/delivery-addresses/$addressId');
      final response = await http.delete(uri, headers: headers).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Dirección eliminada'), backgroundColor: LuxeColors.nude900),
          );
          setState(() {});
        }
      } else {
        throw Exception('Error al eliminar');
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: const Color(0xFFB00020)),
        );
      }
    }
  }

  Widget _buildAddressCard(Map<String, dynamic> addr) {
    final isDefault = addr['es_default'] == true;
    final formatted = addr['direccion_formateada'] ?? _buildFormattedAddress(addr);
    final alias = addr['alias'];

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: isDefault ? LuxeColors.gold50 : LuxeColors.nude100,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isDefault ? LuxeColors.gold200 : LuxeColors.nude200,
          width: isDefault ? 1.5 : 1,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        children: [
          // Header con alias y badge default
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: isDefault ? LuxeColors.gold100 : LuxeColors.nude200,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    Icons.home_outlined,
                    color: isDefault ? LuxeColors.gold700 : LuxeColors.nude600,
                    size: 22,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          if (alias != null && alias.isNotEmpty)
                            Text(
                              alias,
                              style: const TextStyle(
                                fontFamily: 'CormorantGaramond',
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: LuxeColors.nude900,
                              ),
                            )
                          else
                            const Text(
                              'Dirección de entrega',
                              style: TextStyle(
                                fontFamily: 'CormorantGaramond',
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: LuxeColors.nude900,
                              ),
                            ),
                          const SizedBox(width: 8),
                          if (isDefault)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: LuxeColors.gold700,
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: const Text(
                                'PREDETERMINADA',
                                style: TextStyle(
                                  fontSize: 9,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.white,
                                  letterSpacing: 0.5,
                                ),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        formatted,
                        style: const TextStyle(
                          fontSize: 12.5,
                          color: LuxeColors.nude700,
                          height: 1.3,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                // Botón editar discreto
                IconButton(
                  onPressed: () => _showAddressBuilder(addressToEdit: addr),
                  icon: const Icon(Icons.edit_outlined, size: 20, color: LuxeColors.nude500),
                  tooltip: 'Editar dirección',
                  style: IconButton.styleFrom(
                    backgroundColor: LuxeColors.nude200.withValues(alpha: 0.5),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ],
            ),
          ),

          // Acciones
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Row(
              children: [
                if (!isDefault)
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _setDefaultAddress(addr['id']),
                      icon: const Icon(Icons.check_circle_outline, size: 16),
                      label: const Text('Establecer por defecto'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: LuxeColors.gold700,
                        side: const BorderSide(color: LuxeColors.gold300),
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  )
                else
                  const Expanded(child: SizedBox()),
                if (!isDefault) const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _showAddressBuilder(addressToEdit: addr),
                    icon: const Icon(Icons.edit_outlined, size: 16),
                    label: const Text('Editar'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: LuxeColors.nude700,
                      side: const BorderSide(color: LuxeColors.nude300),
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  onPressed: () => _deleteAddress(addr['id']),
                  icon: const Icon(Icons.delete_outline, size: 18, color: LuxeColors.nude500),
                  tooltip: 'Eliminar',
                  style: IconButton.styleFrom(
                    backgroundColor: LuxeColors.nude200.withValues(alpha: 0.5),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<dynamic>>(
      future: _fetchDeliveryAddresses(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: CircularProgressIndicator(),
            ),
          );
        }

        if (snapshot.hasError) {
          return Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFFB00020).withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFFB00020).withValues(alpha: 0.3)),
            ),
            child: Row(
              children: [
                const Icon(Icons.error_outline, color: Color(0xFFB00020)),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Error al cargar direcciones: ${snapshot.error}',
                    style: const TextStyle(color: Color(0xFFB00020)),
                  ),
                ),
                TextButton(
                  onPressed: () => setState(() {}),
                  child: const Text('Reintentar'),
                ),
              ],
            ),
          );
        }

        final addresses = snapshot.data ?? [];

        return Column(
          children: [
            // Lista de direcciones
            if (addresses.isEmpty)
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: LuxeColors.nude100,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: LuxeColors.nude200),
                ),
                child: Column(
                  children: [
                    const Icon(Icons.location_off_outlined, size: 48, color: LuxeColors.nude400),
                    const SizedBox(height: 12),
                    const Text(
                      'No tienes direcciones de entrega guardadas',
                      style: TextStyle(
                        fontFamily: 'CormorantGaramond',
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: LuxeColors.nude700,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Agrega una dirección para que se autocomplete en el checkout de GlowStore',
                      style: TextStyle(fontSize: 13, color: LuxeColors.nude500),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton.icon(
                      onPressed: () => _showAddressBuilder(),
                      icon: const Icon(Icons.add_location_alt_outlined, size: 18),
                      label: const Text('Agregar primera dirección'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: LuxeColors.nude900,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                    ),
                  ],
                ),
              )
            else
              ...addresses.map((addr) => _buildAddressCard(addr)),

            const SizedBox(height: 12),

            // Botón agregar nueva dirección
            OutlinedButton.icon(
              onPressed: () => _showAddressBuilder(),
              icon: const Icon(Icons.add_location_alt_outlined, size: 18, color: LuxeColors.nude700),
              label: const Text(
                'Agregar otra dirección',
                style: TextStyle(color: LuxeColors.nude700, fontWeight: FontWeight.w600),
              ),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 24),
                side: const BorderSide(color: LuxeColors.nude300),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ],
        );
      },
    );
  }
}
