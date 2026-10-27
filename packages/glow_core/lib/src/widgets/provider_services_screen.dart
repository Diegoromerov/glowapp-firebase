// frontend/lib/screens/provider_services_screen.dart
import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../models/service_model.dart';
import '../shared/theme.dart';

class ProviderServicesScreen extends StatefulWidget {
  const ProviderServicesScreen({super.key});

  @override
  State<ProviderServicesScreen> createState() => _ProviderServicesScreenState();
}

class _ProviderServicesScreenState extends State<ProviderServicesScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<ServiceModel> _services = [];
  bool _isLoading = true;
  String? _error;
  String _searchQuery = '';
  String _selectedCategoryFilter = 'Todos';

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadServices();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadServices() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final data = await ApiService.fetchProviderServices();
      if (mounted) {
        setState(() {
          _services = data;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _submitServiceHelper({
    ServiceModel? service,
    required String name,
    required double price,
    required int duration,
    String? description,
    String? category,
    required bool isActive,
  }) async {
    setState(() => _isLoading = true);
    try {
      if (service == null) {
        await ApiService.createService(
          name: name,
          price: price,
          durationMinutes: duration,
          description: description,
          category: category,
          isActive: isActive,
        );
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Text('✅ Servicio creado con éxito'),
              backgroundColor: AppTheme.primary,
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20)),
            ),
          );
        }
      } else {
        await ApiService.updateService(
          id: service.id,
          name: name,
          price: price,
          durationMinutes: duration,
          description: description,
          category: category,
          isActive: isActive,
        );
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Text('✅ Servicio actualizado con éxito'),
              backgroundColor: AppTheme.primary,
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20)),
            ),
          );
        }
      }
      _loadServices();
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('❌ Error: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _showServiceForm({ServiceModel? service}) async {
    final nameCtrl = TextEditingController(text: service?.name ?? '');
    final descCtrl = TextEditingController(text: service?.description ?? '');
    final priceCtrl = TextEditingController(
        text: service != null ? service.price.toInt().toString() : '');
    final durationCtrl =
        TextEditingController(text: service?.durationMinutes.toString() ?? '');
    final categoryCtrl = TextEditingController(text: service?.category ?? 'Cabello');
    final formKey = GlobalKey<FormState>();
    bool isActive = service?.isActive ?? true;

    // 💡 Propuesta A: Plantillas Rápidas según Categoría
    final Map<String, List<Map<String, dynamic>>> serviceTemplates = {
      'Cabello': [
        {
          'name': 'Balayage Cenizo + Hidratación',
          'price': 320000,
          'duration': 180,
          'desc': 'Técnica de iluminación capilar con cuidado protector.'
        },
        {
          'name': 'Corte Tendencia + Cepillado',
          'price': 65000,
          'duration': 60,
          'desc': 'Corte moderno personalizado con lavado y cepillado.'
        },
        {
          'name': 'Tratamiento de Keratina',
          'price': 180000,
          'duration': 120,
          'desc': 'Alisado e hidratación profunda con sellado de cutícula.'
        },
      ],
      'Uñas': [
        {
          'name': 'Manicura Semipermanente',
          'price': 55000,
          'duration': 60,
          'desc': 'Limpieza, limado y esmaltado semipermanente de alta duración.'
        },
        {
          'name': 'Extensiones Gel-X',
          'price': 120000,
          'duration': 100,
          'desc': 'Extensión de uñas elegantes con acabado natural.'
        },
        {
          'name': 'Pedicura Spa Profunda',
          'price': 60000,
          'duration': 60,
          'desc': 'Exfoliación, masaje e hidratación profunda para pies.'
        },
      ],
      'Maquillaje': [
        {
          'name': 'Maquillaje Social Premium',
          'price': 140000,
          'duration': 75,
          'desc': 'Maquillaje elegante de larga duración para eventos.'
        },
        {
          'name': 'Maquillaje de Novia con Prueba',
          'price': 280000,
          'duration': 120,
          'desc': 'Maquillaje especializado con prueba previa incluida.'
        },
      ],
      'Cuidado de la piel': [
        {
          'name': 'Limpieza Facial Profunda',
          'price': 95000,
          'duration': 75,
          'desc': 'Higienización facial con extracción de impurezas.'
        },
        {
          'name': 'Hidratación Ácido Hialurónico',
          'price': 120000,
          'duration': 60,
          'desc': 'Tratamiento intensivo de nutrición y rejuvenecimiento.'
        },
      ],
      'Barbería': [
        {
          'name': 'Corte Premium + Perfilado de Barba',
          'price': 45000,
          'duration': 50,
          'desc': 'Corte masculino con toalla caliente y perfilado de barba.'
        },
        {
          'name': 'Camuflaje de Canas',
          'price': 50000,
          'duration': 40,
          'desc': 'Coloración rápida y natural de barba y cabello.'
        },
      ],
      'Otros': [
        {
          'name': 'Diseño de Cejas + Henna',
          'price': 40000,
          'duration': 45,
          'desc': 'Perfilado de cejas con pigmentación temporal natural.'
        },
      ],
    };

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFFFAF8F5),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (context) {
        return StatefulBuilder(
          builder: (BuildContext context, StateSetter setModalState) {
            final activeCat = categoryCtrl.text.trim().isNotEmpty
                ? categoryCtrl.text.trim()
                : 'Cabello';
            final currentTemplates = serviceTemplates[activeCat] ?? serviceTemplates['Otros'] ?? [];

            return Padding(
              padding: EdgeInsets.only(
                bottom: MediaQuery.of(context).viewInsets.bottom,
                left: 22,
                right: 22,
                top: 20,
              ),
              child: SingleChildScrollView(
                child: Form(
                  key: formKey,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(
                        child: Container(
                          width: 44,
                          height: 4,
                          decoration: BoxDecoration(
                            color: const Color(0xFFE8DFD8),
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        service == null ? 'Nuevo Servicio' : 'Editar Servicio',
                        style: const TextStyle(
                          fontFamily: 'CormorantGaramond',
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF1F1A15),
                          letterSpacing: -0.3,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 16),
                      // 🚀 Propuesta A: Fila de Plantillas Rápidas AutoFill
                      if (service == null) ...[
                        Row(
                          children: [
                            const Icon(Icons.auto_awesome_rounded,
                                size: 14, color: Color(0xFFC5A052)),
                            const SizedBox(width: 6),
                            Text(
                              'Plantillas rápidas ($activeCat):',
                              style: const TextStyle(
                                fontFamily: 'Inter',
                                fontSize: 12,
                                color: Color(0xFF8C7E74),
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(
                            children: currentTemplates.map((t) {
                              return Padding(
                                padding: const EdgeInsets.only(right: 8),
                                child: ActionChip(
                                  avatar: const Icon(Icons.flash_on_rounded,
                                      size: 13, color: Color(0xFFC5A052)),
                                  label: Text(t['name'] as String),
                                  backgroundColor: const Color(0xFFFFF7E6),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(14),
                                    side: const BorderSide(
                                        color: Color(0xFFC5A052), width: 1),
                                  ),
                                  labelStyle: const TextStyle(
                                    fontFamily: 'Inter',
                                    fontSize: 11.5,
                                    fontWeight: FontWeight.bold,
                                    color: Color(0xFF1F1A15),
                                  ),
                                  onPressed: () {
                                    setModalState(() {
                                      nameCtrl.text = t['name'] as String;
                                      priceCtrl.text = (t['price'] as int).toString();
                                      durationCtrl.text = (t['duration'] as int).toString();
                                      descCtrl.text = t['desc'] as String;
                                    });
                                  },
                                ),
                              );
                            }).toList(),
                          ),
                        ),
                        const SizedBox(height: 14),
                      ],
                      TextFormField(
                        controller: nameCtrl,
                        decoration: _inputDecoration('Nombre del servicio *', Icons.spa_outlined),
                        style: const TextStyle(fontFamily: 'Inter', fontSize: 14, color: Color(0xFF1F1A15)),
                        validator: (v) => v == null || v.trim().isEmpty ? 'Requerido' : null,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: descCtrl,
                        decoration: _inputDecoration('Descripción (opcional)', Icons.description_outlined),
                        style: const TextStyle(fontFamily: 'Inter', fontSize: 14, color: Color(0xFF1F1A15)),
                        maxLines: 2,
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: TextFormField(
                              controller: priceCtrl,
                              decoration: _inputDecoration('Precio (COP) *', Icons.attach_money_rounded),
                              style: const TextStyle(fontFamily: 'Inter', fontSize: 14, color: Color(0xFF1F1A15)),
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              // 🔢 Propuesta C: Validador y Sanitizador de Moneda COP
                              validator: (v) {
                                if (v == null || v.trim().isEmpty) return 'Requerido';
                                final clean = v.replaceAll('.', '').replaceAll(',', '.').replaceAll(RegExp(r'[^\d.]'), '');
                                final price = double.tryParse(clean);
                                if (price == null || price < 0) return 'Precio inválido';
                                return null;
                              },
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: TextFormField(
                              controller: durationCtrl,
                              decoration: _inputDecoration('Duración (min) *', Icons.access_time_rounded),
                              style: const TextStyle(fontFamily: 'Inter', fontSize: 14, color: Color(0xFF1F1A15)),
                              keyboardType: TextInputType.number,
                              validator: (v) {
                                if (v == null || v.isEmpty) return 'Requerido';
                                final dur = int.tryParse(v);
                                if (dur == null || dur <= 0) return 'Duración inválida';
                                return null;
                              },
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      const Text(
                        'Selección rápida de duración:',
                        style: TextStyle(
                          fontFamily: 'Inter',
                          fontSize: 12,
                          color: Color(0xFF8C7E74),
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 6),
                      StatefulBuilder(builder: (context, setChipState) {
                        return Wrap(
                          spacing: 8,
                          runSpacing: 6,
                          children: [30, 45, 60, 90, 120].map((mins) {
                            final labelText = '$mins min';
                            final isSelected = durationCtrl.text == mins.toString();
                            return ChoiceChip(
                              label: Text(labelText),
                              selected: isSelected,
                              onSelected: (selected) {
                                if (selected) {
                                  setModalState(() => durationCtrl.text = mins.toString());
                                  setChipState(() {});
                                }
                              },
                              selectedColor: const Color(0xFFFFF7E6),
                              backgroundColor: const Color(0xFFFAF6EE),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(14),
                                side: BorderSide(
                                  color: isSelected ? const Color(0xFFC5A052) : const Color(0xFFE8DFD8),
                                  width: isSelected ? 1.5 : 1,
                                ),
                              ),
                              labelStyle: TextStyle(
                                fontFamily: 'Inter',
                                color: isSelected ? const Color(0xFF1F1A15) : const Color(0xFF8C7E74),
                                fontSize: 12,
                                fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                              ),
                            );
                          }).toList(),
                        );
                      }),
                      const SizedBox(height: 14),
                      DropdownButtonFormField<String>(
                        initialValue: categoryCtrl.text.trim().isEmpty
                            ? 'Cabello'
                            : ([
                                'Cabello',
                                'Uñas',
                                'Maquillaje',
                                'Cuidado de la piel',
                                'Barbería',
                                'Otros'
                              ].contains(categoryCtrl.text.trim())
                                ? categoryCtrl.text.trim()
                                : 'Otros'),
                        style: const TextStyle(
                          fontFamily: 'Inter',
                          color: Color(0xFF1F1A15),
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                        ),
                        decoration: _inputDecoration('Categoría *', Icons.category_outlined),
                        items: ['Cabello', 'Uñas', 'Maquillaje', 'Cuidado de la piel', 'Barbería', 'Otros']
                            .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                            .toList(),
                        onChanged: (v) {
                          if (v != null) {
                            setModalState(() => categoryCtrl.text = v);
                          }
                        },
                        validator: (v) => v == null || v.isEmpty ? 'Requerido' : null,
                      ),
                      const SizedBox(height: 14),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFAF6EE),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFFE8DFD8), width: 1),
                        ),
                        child: SwitchListTile(
                          title: const Text(
                            'Servicio activo',
                            style: TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF1F1A15)),
                          ),
                          subtitle: Text(
                            isActive ? 'Visible en el catálogo público' : 'Oculto en el catálogo público',
                            style: const TextStyle(fontFamily: 'Inter', fontSize: 12, color: Color(0xFF8C7E74)),
                          ),
                          value: isActive,
                          activeThumbColor: const Color(0xFFC5A052),
                          onChanged: (v) => setModalState(() => isActive = v),
                          contentPadding: EdgeInsets.zero,
                        ),
                      ),
                      const SizedBox(height: 24),
                      Container(
                        height: 52,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(16),
                          gradient: const LinearGradient(
                            colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: const Color(0xFFC5A052).withValues(alpha: 0.3),
                              blurRadius: 10,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: ElevatedButton(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.transparent,
                            shadowColor: Colors.transparent,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                          ),
                          onPressed: () {
                            if (formKey.currentState!.validate()) {
                              Navigator.pop(context);
                              // 🔢 Propuesta C: Sanitización de precio antes del envío
                              final cleanPriceStr = priceCtrl.text
                                  .replaceAll('.', '')
                                  .replaceAll(',', '.')
                                  .replaceAll(RegExp(r'[^\d.]'), '');
                              _submitServiceHelper(
                                service: service,
                                name: nameCtrl.text.trim(),
                                price: double.parse(cleanPriceStr),
                                duration: int.parse(durationCtrl.text),
                                description: descCtrl.text.trim().isNotEmpty ? descCtrl.text.trim() : null,
                                category: categoryCtrl.text.trim().isNotEmpty ? categoryCtrl.text.trim() : null,
                                isActive: isActive,
                              );
                            }
                          },
                          child: Text(
                            service == null ? 'Crear Servicio' : 'Guardar Cambios',
                            style: const TextStyle(
                              fontFamily: 'Inter',
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF1F1A15),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }

  InputDecoration _inputDecoration(String label, IconData icon) {
    return InputDecoration(
      labelText: label,
      labelStyle: const TextStyle(color: Color(0xFF8C7E74), fontSize: 13, fontFamily: 'Inter'),
      prefixIcon: Icon(icon, color: const Color(0xFFC5A052)),
      floatingLabelBehavior: FloatingLabelBehavior.auto,
      filled: true,
      fillColor: const Color(0xFFFAF6EE),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFFE8DFD8), width: 1),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFFE8DFD8), width: 1),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFFC5A052), width: 1.5),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
    );
  }

  Future<void> _confirmDelete(ServiceModel service) async {
    final isCurrentlyActive = service.isActive;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: Row(
          children: [
            Icon(
              isCurrentlyActive
                  ? Icons.warning_amber_rounded
                  : Icons.check_circle_outline_rounded,
              color: isCurrentlyActive ? Colors.redAccent : Colors.green,
              size: 28,
            ),
            const SizedBox(width: 8),
            Text(
              isCurrentlyActive
                  ? '¿Desactivar servicio?'
                  : '¿Activar servicio?',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
            ),
          ],
        ),
        content: Text(
          isCurrentlyActive
              ? '¿Estás seguro de que deseas desactivar "${service.name}"? Los clientes no podrán reservarlo, pero el historial de citas se mantendrá.'
              : '¿Estás seguro de que deseas activar "${service.name}"? Los clientes podrán reservarlo nuevamente.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Volver',
                style:
                    TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: isCurrentlyActive
                  ? const Color(0xFFFEE2E2)
                  : const Color(0xFFDCFCE7),
              foregroundColor: isCurrentlyActive
                  ? const Color(0xFFDC2626)
                  : const Color(0xFF16A34A),
              elevation: 0,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(30)),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            ),
            child: Text(
              isCurrentlyActive ? 'Desactivar' : 'Activar',
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );

    if (confirm == true) {
      setState(() => _isLoading = true);
      try {
        if (isCurrentlyActive) {
          await ApiService.deleteService(service.id);
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: const Text('✅ Servicio desactivado'),
                backgroundColor: AppTheme.primary,
                behavior: SnackBarBehavior.floating,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20)),
              ),
            );
          }
        } else {
          await ApiService.updateService(
            id: service.id,
            name: service.name,
            price: service.price,
            durationMinutes: service.durationMinutes,
            description: service.description,
            category: service.category,
            isActive: true,
          );
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: const Text('✅ Servicio activado'),
                backgroundColor: AppTheme.primary,
                behavior: SnackBarBehavior.floating,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20)),
              ),
            );
          }
        }
        _loadServices();
      } catch (e) {
        if (mounted) {
          setState(() => _isLoading = false);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('❌ Error: $e'), backgroundColor: Colors.red),
          );
        }
      }
    }
  }

  List<ServiceModel> _applyFilters(List<ServiceModel> list) {
    return list.where((s) {
      final matchesSearch = _searchQuery.isEmpty ||
          s.name.toLowerCase().contains(_searchQuery.toLowerCase()) ||
          s.description.toLowerCase().contains(_searchQuery.toLowerCase());
      final matchesCategory = _selectedCategoryFilter == 'Todos' ||
          s.category.toLowerCase().trim() == _selectedCategoryFilter.toLowerCase().trim();
      return matchesSearch && matchesCategory;
    }).toList();
  }

  Widget _buildFilterAndSearchHeader() {
    final categories = ['Todos', 'Cabello', 'Uñas', 'Maquillaje', 'Cuidado de la piel', 'Barbería', 'Otros'];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: TextField(
            onChanged: (val) => setState(() => _searchQuery = val),
            style: const TextStyle(fontFamily: 'Inter', fontSize: 13.5, color: Color(0xFF1F1A15)),
            decoration: InputDecoration(
              hintText: 'Buscar servicio por nombre...',
              hintStyle: const TextStyle(color: Color(0xFF8C7E74), fontSize: 13),
              prefixIcon: const Icon(Icons.search_rounded, color: Color(0xFFC5A052), size: 18),
              suffixIcon: _searchQuery.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear_rounded, size: 16, color: Color(0xFF8C7E74)),
                      onPressed: () => setState(() => _searchQuery = ''),
                    )
                  : null,
              filled: true,
              fillColor: Colors.white,
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: const BorderSide(color: Color(0xFFEFE8DE), width: 1),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: const BorderSide(color: Color(0xFFEFE8DE), width: 1),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: const BorderSide(color: Color(0xFFC5A052), width: 1.5),
              ),
            ),
          ),
        ),
        SizedBox(
          height: 38,
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            scrollDirection: Axis.horizontal,
            itemCount: categories.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (context, index) {
              final cat = categories[index];
              final isSelected = _selectedCategoryFilter == cat;
              return ChoiceChip(
                label: Text(cat),
                selected: isSelected,
                onSelected: (selected) {
                  if (selected) setState(() => _selectedCategoryFilter = cat);
                },
                selectedColor: const Color(0xFFFFF7E6),
                backgroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                  side: BorderSide(
                    color: isSelected ? const Color(0xFFC5A052) : const Color(0xFFEFE8DE),
                    width: isSelected ? 1.5 : 1,
                  ),
                ),
                labelStyle: TextStyle(
                  fontFamily: 'Inter',
                  color: isSelected ? const Color(0xFF1F1A15) : const Color(0xFF8C7E74),
                  fontSize: 12,
                  fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 8),
      ],
    );
  }

  Widget _buildEmptyState(String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.inventory_2_outlined,
                size: 64, color: AppTheme.primary),
            const SizedBox(height: 16),
            Text(message,
                style: const TextStyle(
                    fontSize: 15,
                    color: Colors.grey,
                    fontWeight: FontWeight.w500),
                textAlign: TextAlign.center),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: () => _showServiceForm(),
              icon: const Icon(Icons.add),
              label: const Text('Agregar Primer Servicio'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(30)),
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                elevation: 0,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildServiceCard(ServiceModel service) {
    final statusColor =
        service.isActive ? const Color(0xFF16A34A) : Colors.grey;
    final statusBgColor =
        service.isActive ? const Color(0xFFDCFCE7) : const Color(0xFFF3F4F6);

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFEFE8DE), width: 1.2),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A000000),
            blurRadius: 16,
            offset: Offset(0, 4),
          )
        ],
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: () => _showServiceForm(service: service),
        child: Opacity(
          opacity: service.isActive ? 1.0 : 0.6,
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            service.name,
                            style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 16,
                                letterSpacing: -0.3),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          Row(
                            children: [
                              if (service.category.isNotEmpty) ...[
                                Text(
                                  service.category,
                                  style: TextStyle(
                                      color: Colors.grey[600], fontSize: 13),
                                ),
                                const SizedBox(width: 8),
                                const Text('•',
                                    style: TextStyle(color: Colors.grey)),
                                const SizedBox(width: 8),
                              ],
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFF5EBE6),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(Icons.star,
                                        color: Colors.amber, size: 12),
                                    const SizedBox(width: 2),
                                    Text(
                                      '${service.bookingsCount} reservas',
                                      style: const TextStyle(
                                        color: AppTheme.primary,
                                        fontSize: 11,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: statusBgColor,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        service.isActive ? 'Activo' : 'Inactivo',
                        style: TextStyle(
                          color: statusColor,
                          fontWeight: FontWeight.bold,
                          fontSize: 11,
                        ),
                      ),
                    ),
                  ],
                ),
                if (service.description.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    service.description,
                    style: TextStyle(
                        color: Colors.grey[600], fontSize: 13, height: 1.4),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                const Divider(height: 24, color: Color(0xFFF3F4F6)),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.access_time_filled_rounded,
                            size: 14, color: Colors.grey[500]),
                        const SizedBox(width: 4),
                        Text('${service.durationMinutes} min',
                            style: TextStyle(
                                color: Colors.grey[600], fontSize: 13)),
                      ],
                    ),
                    Text(
                      service.formattedPrice,
                      style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.primary),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => _showServiceForm(service: service),
                        icon: const Icon(Icons.edit_outlined, size: 16),
                        label: const Text('Editar'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppTheme.primary,
                          side: const BorderSide(color: Color(0xFFE5CECA)),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(30)),
                          padding: const EdgeInsets.symmetric(vertical: 10),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => _confirmDelete(service),
                        icon: const Icon(Icons.block_outlined, size: 16),
                        label:
                            Text(service.isActive ? 'Desactivar' : 'Activar'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor:
                              service.isActive ? Colors.red : Colors.green,
                          side: BorderSide(
                              color: (service.isActive
                                  ? Colors.red
                                  : Colors.green)[200]!),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(30)),
                          padding: const EdgeInsets.symmetric(vertical: 10),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading && _services.isEmpty) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Mis Servicios',
              style:
                  TextStyle(fontWeight: FontWeight.bold, letterSpacing: -0.5)),
          backgroundColor: Colors.white,
          foregroundColor: Colors.black,
          elevation: 0,
        ),
        body: const Center(
            child: CircularProgressIndicator(color: AppTheme.primary)),
      );
    }

    if (_error != null && _services.isEmpty) {
      return Scaffold(
        backgroundColor: const Color(0xFFFAF8F5),
        appBar: AppBar(
          title: const Text(
            'Mis Servicios',
            style: TextStyle(
              fontFamily: 'CormorantGaramond',
              fontWeight: FontWeight.bold,
              fontSize: 20,
              color: Color(0xFF1F1A15),
            ),
          ),
          backgroundColor: const Color(0xFFFAF8F5),
          foregroundColor: const Color(0xFF1F1A15),
          elevation: 0,
          centerTitle: true,
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: const BoxDecoration(
                    color: Color(0xFFFAF6EE),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.wifi_off_rounded, size: 48, color: Color(0xFFC5A052)),
                ),
                const SizedBox(height: 20),
                const Text(
                  'Error de Conexión',
                  style: TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF1F1A15),
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'No pudimos cargar tu catálogo de servicios. Por favor verifica tu red e intenta de nuevo.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: 'Inter',
                    fontSize: 13.5,
                    color: Color(0xFF6B5E55),
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 24),
                SizedBox(
                  height: 48,
                  width: 200,
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF1F1A15),
                      foregroundColor: const Color(0xFFC5A052),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                      elevation: 0,
                    ),
                    onPressed: _loadServices,
                    icon: const Icon(Icons.refresh_rounded, size: 18),
                    label: const Text(
                      'Reintentar',
                      style: TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final active = _services.where((s) => s.isActive).toList();
    final inactive = _services.where((s) => !s.isActive).toList();
    final filteredActive = _applyFilters(active);
    final filteredInactive = _applyFilters(inactive);

    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        leading: Padding(
          padding: const EdgeInsets.only(left: 14),
          child: Center(
            child: InkWell(
              onTap: () => Navigator.maybePop(context),
              borderRadius: BorderRadius.circular(20),
              child: Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0xFFE8DFD8), width: 1),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.04),
                      blurRadius: 6,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: const Icon(Icons.arrow_back_ios_new_rounded, size: 15, color: Color(0xFF1F1A15)),
              ),
            ),
          ),
        ),
        title: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.spa_rounded, size: 18, color: Color(0xFFC5A052)),
            SizedBox(width: 8),
            Text(
              'Catálogo de Servicios',
              style: TextStyle(
                fontFamily: 'CormorantGaramond',
                fontSize: 22,
                fontWeight: FontWeight.bold,
                color: Color(0xFF1F1A15),
                letterSpacing: 0.5,
              ),
            ),
          ],
        ),
        backgroundColor: const Color(0xFFFAF8F5),
        foregroundColor: const Color(0xFF1F1A15),
        elevation: 0,
        scrolledUnderElevation: 0,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 14),
            child: Center(
              child: InkWell(
                onTap: _loadServices,
                borderRadius: BorderRadius.circular(20),
                child: Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0xFFE8DFD8), width: 1),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.04),
                        blurRadius: 6,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: const Icon(Icons.refresh_rounded, size: 18, color: Color(0xFF1F1A15)),
                ),
              ),
            ),
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: const Color(0xFFEFE8DE), width: 1),
            ),
            child: TabBar(
              controller: _tabController,
              indicator: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFFFFF7E6), Color(0xFFF6E7C8)],
                ),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFFD4AF37).withValues(alpha: 0.5), width: 1),
              ),
              indicatorSize: TabBarIndicatorSize.tab,
              labelColor: const Color(0xFF1F1A15),
              unselectedLabelColor: const Color(0xFF8C7E74),
              labelStyle: const TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.bold, fontSize: 13),
              unselectedLabelStyle: const TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w500, fontSize: 13),
              dividerColor: Colors.transparent,
              tabs: [
                Tab(text: 'Activos (${active.length})'),
                Tab(text: 'Inactivos (${inactive.length})'),
              ],
            ),
          ),
        ),
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: Stack(
            children: [
              Column(
                children: [
                  const SizedBox(height: 8),
                  _buildFilterAndSearchHeader(),
                  Expanded(
                    child: TabBarView(
                      controller: _tabController,
                      children: [
                        RefreshIndicator(
                          color: const Color(0xFFC5A052),
                          onRefresh: _loadServices,
                          child: filteredActive.isEmpty
                              ? _buildEmptyState(
                                  _searchQuery.isNotEmpty || _selectedCategoryFilter != 'Todos'
                                      ? 'No se encontraron servicios que coincidan con la búsqueda.'
                                      : 'No tienes servicios activos.\nToca el botón + para agregar uno.')
                              : ListView.builder(
                                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                                  itemCount: filteredActive.length,
                                  itemBuilder: (context, index) =>
                                      _buildServiceCard(filteredActive[index]),
                                ),
                        ),
                        RefreshIndicator(
                          color: const Color(0xFFC5A052),
                          onRefresh: _loadServices,
                          child: filteredInactive.isEmpty
                              ? Center(
                                  child: Padding(
                                    padding: const EdgeInsets.all(24.0),
                                    child: Text(
                                      _searchQuery.isNotEmpty || _selectedCategoryFilter != 'Todos'
                                          ? 'No se encontraron servicios inactivos que coincidan.'
                                          : 'No tienes servicios inactivos.',
                                      style: const TextStyle(
                                          fontFamily: 'Inter',
                                          fontSize: 15,
                                          color: Color(0xFF8C7E74),
                                          fontWeight: FontWeight.w500),
                                      textAlign: TextAlign.center,
                                    ),
                                  ),
                                )
                              : ListView.builder(
                                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                                  itemCount: filteredInactive.length,
                                  itemBuilder: (context, index) =>
                                      _buildServiceCard(filteredInactive[index]),
                                ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if (_isLoading)
                Container(
                  color: const Color(0x1E000000),
                  child: const Center(
                      child: CircularProgressIndicator(color: Color(0xFFC5A052))),
                ),
            ],
          ),
        ),
      ),
      floatingActionButton: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(28),
          gradient: const LinearGradient(
            colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFFC5A052).withValues(alpha: 0.35),
              blurRadius: 14,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: FloatingActionButton.extended(
          onPressed: () => _showServiceForm(),
          backgroundColor: Colors.transparent,
          elevation: 0,
          highlightElevation: 0,
          icon: const Icon(Icons.add_rounded, color: Color(0xFF1F1A15), size: 20),
          label: const Text(
            'Crear Servicio',
            style: TextStyle(
              fontFamily: 'Inter',
              fontWeight: FontWeight.bold,
              fontSize: 14,
              color: Color(0xFF1F1A15),
            ),
          ),
        ),
      ),
    );
  }
}
