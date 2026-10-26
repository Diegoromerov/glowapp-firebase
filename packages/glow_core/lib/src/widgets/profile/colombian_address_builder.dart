import 'package:flutter/material.dart';
import '../../shared/theme.dart';

// Tipos de vía colombianos
const List<String> _tiposVia = [
  'Calle',
  'Carrera',
  'Avenida',
  'Diagonal',
  'Transversal',
  'Circular',
  'Vía',
  'Autopista',
  'Boulevard',
  'Pasaje',
  'Sendero',
];

// Complementos comunes
const List<String> _complementos = [
  'Apartamento',
  'Interior',
  'Oficina',
  'Casa',
  'Torre',
  'Bloque',
  'Local',
  'Bodega',
  'Unidad',
  'Finca',
  'Lote',
  'Parqueadero',
];

// Departamentos de Colombia (principales)
const List<String> _departamentos = [
  'Antioquia',
  'Atlántico',
  'Bogotá D.C.',
  'Bolívar',
  'Boyacá',
  'Caldas',
  'Caquetá',
  'Casanare',
  'Cauca',
  'Cesar',
  'Chocó',
  'Córdoba',
  'Cundinamarca',
  'Guainía',
  'Guaviare',
  'Huila',
  'La Guajira',
  'Magdalena',
  'Meta',
  'Nariño',
  'Norte de Santander',
  'Putumayo',
  'Quindío',
  'Risaralda',
  'San Andrés y Providencia',
  'Santander',
  'Sucre',
  'Tolima',
  'Valle del Cauca',
  'Vaupés',
  'Vichada',
];

class ColombianAddressBuilder extends StatefulWidget {
  final Map<String, dynamic>? initialAddress;
  final Function(Map<String, dynamic>) onSave;
  final VoidCallback? onCancel;

  const ColombianAddressBuilder({
    super.key,
    this.initialAddress,
    required this.onSave,
    this.onCancel,
  });

  @override
  State<ColombianAddressBuilder> createState() => _ColombianAddressBuilderState();
}

class _ColombianAddressBuilderState extends State<ColombianAddressBuilder> {
  final _formKey = GlobalKey<FormState>();
  bool _isLoading = false;
  
  // Controladores
  final _tipoViaCtrl = TextEditingController();
  final _numeroPrincipalCtrl = TextEditingController();
  final _letraPrincipalCtrl = TextEditingController();
  final _numeroSecundarioCtrl = TextEditingController();
  final _letraSecundariaCtrl = TextEditingController();
  final _complementoCtrl = TextEditingController();
  final _letraComplementoCtrl = TextEditingController();
  final _barrioCtrl = TextEditingController();
  final _ciudadCtrl = TextEditingController();
  final _departamentoCtrl = TextEditingController();
  final _codigoPostalCtrl = TextEditingController();
  final _referenciaCtrl = TextEditingController();
  final _aliasCtrl = TextEditingController();
  
  bool _esDefault = false;
  String _previewAddress = '';

  @override
  void initState() {
    super.initState();
    if (widget.initialAddress != null) {
      _loadInitialAddress(widget.initialAddress!);
    }
    // Listeners para preview en tiempo real
    _tipoViaCtrl.addListener(_updatePreview);
    _numeroPrincipalCtrl.addListener(_updatePreview);
    _letraPrincipalCtrl.addListener(_updatePreview);
    _numeroSecundarioCtrl.addListener(_updatePreview);
    _letraSecundariaCtrl.addListener(_updatePreview);
    _complementoCtrl.addListener(_updatePreview);
    _letraComplementoCtrl.addListener(_updatePreview);
    _barrioCtrl.addListener(_updatePreview);
    _ciudadCtrl.addListener(_updatePreview);
    _departamentoCtrl.addListener(_updatePreview);
  }

  void _loadInitialAddress(Map<String, dynamic> addr) {
    _tipoViaCtrl.text = addr['tipo_via'] ?? '';
    _numeroPrincipalCtrl.text = addr['numero_principal'] ?? '';
    _letraPrincipalCtrl.text = addr['letra_principal'] ?? '';
    _numeroSecundarioCtrl.text = addr['numero_secundario'] ?? '';
    _letraSecundariaCtrl.text = addr['letra_secundaria'] ?? '';
    _complementoCtrl.text = addr['complemento']?.split(' ').first ?? '';
    _letraComplementoCtrl.text = addr['complemento']?.split(' ').skip(1).join(' ') ?? '';
    _barrioCtrl.text = addr['barrio'] ?? '';
    _ciudadCtrl.text = addr['ciudad'] ?? '';
    _departamentoCtrl.text = addr['departamento'] ?? '';
    _codigoPostalCtrl.text = addr['codigo_postal'] ?? '';
    _referenciaCtrl.text = addr['referencia'] ?? '';
    _aliasCtrl.text = addr['alias'] ?? '';
    _esDefault = addr['es_default'] ?? false;
    _updatePreview();
  }

  void _updatePreview() {
    final parts = <String>[];
    
    if (_tipoViaCtrl.text.isNotEmpty) parts.add(_tipoViaCtrl.text);
    if (_numeroPrincipalCtrl.text.isNotEmpty) parts.add(_numeroPrincipalCtrl.text);
    if (_letraPrincipalCtrl.text.isNotEmpty) parts.add(_letraPrincipalCtrl.text);
    if (_numeroSecundarioCtrl.text.isNotEmpty) {
      parts.add('#${_numeroSecundarioCtrl.text}');
      if (_letraSecundariaCtrl.text.isNotEmpty) {
        parts.last += '-${_letraSecundariaCtrl.text}';
      }
    }
    if (_complementoCtrl.text.isNotEmpty) {
      String comp = _complementoCtrl.text;
      if (_letraComplementoCtrl.text.isNotEmpty) {
        comp += ' ${_letraComplementoCtrl.text}';
      }
      parts.add(comp);
    }
    if (_barrioCtrl.text.isNotEmpty) parts.add(_barrioCtrl.text);
    if (_ciudadCtrl.text.isNotEmpty) parts.add(_ciudadCtrl.text);
    if (_departamentoCtrl.text.isNotEmpty) parts.add(_departamentoCtrl.text);
    
    setState(() {
      _previewAddress = parts.join(', ');
    });
  }

  Map<String, dynamic> _buildAddressData() {
    String complementoCompleto = _complementoCtrl.text;
    if (_letraComplementoCtrl.text.isNotEmpty) {
      complementoCompleto += ' ${_letraComplementoCtrl.text}';
    }
    
    return {
      'tipo_via': _tipoViaCtrl.text,
      'numero_principal': _numeroPrincipalCtrl.text,
      'letra_principal': _letraPrincipalCtrl.text.isEmpty ? null : _letraPrincipalCtrl.text,
      'numero_secundario': _numeroSecundarioCtrl.text.isEmpty ? null : _numeroSecundarioCtrl.text,
      'letra_secundaria': _letraSecundariaCtrl.text.isEmpty ? null : _letraSecundariaCtrl.text,
      'complemento': complementoCompleto.isEmpty ? null : complementoCompleto,
      'barrio': _barrioCtrl.text.isEmpty ? null : _barrioCtrl.text,
      'ciudad': _ciudadCtrl.text,
      'departamento': _departamentoCtrl.text,
      'codigo_postal': _codigoPostalCtrl.text.isEmpty ? null : _codigoPostalCtrl.text,
      'referencia': _referenciaCtrl.text.isEmpty ? null : _referenciaCtrl.text,
      'alias': _aliasCtrl.text.isEmpty ? null : _aliasCtrl.text,
      'es_default': _esDefault,
    };
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    
    setState(() => _isLoading = true);
    
    try {
      widget.onSave(_buildAddressData());
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(widget.initialAddress != null 
              ? 'Dirección actualizada' 
              : 'Dirección guardada'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  void dispose() {
    _tipoViaCtrl.dispose();
    _numeroPrincipalCtrl.dispose();
    _letraPrincipalCtrl.dispose();
    _numeroSecundarioCtrl.dispose();
    _letraSecundariaCtrl.dispose();
    _complementoCtrl.dispose();
    _letraComplementoCtrl.dispose();
    _barrioCtrl.dispose();
    _ciudadCtrl.dispose();
    _departamentoCtrl.dispose();
    _codigoPostalCtrl.dispose();
    _referenciaCtrl.dispose();
    _aliasCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.85,
        maxWidth: 560,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Header
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: AppTheme.primary.withValues(alpha: 0.05),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
            ),
            child: Row(
              children: [
                const Icon(Icons.location_on_outlined, color: AppTheme.primary, size: 24),
                const SizedBox(width: 12),
                Text(
                  widget.initialAddress != null 
                    ? 'Editar dirección de entrega' 
                    : 'Nueva dirección de entrega',
                  style: const TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.text,
                  ),
                ),
                const Spacer(),
                if (widget.onCancel != null)
                  IconButton(
                    icon: const Icon(Icons.close, color: AppTheme.text),
                    onPressed: widget.onCancel,
                  ),
              ],
            ),
          ),
          
          // Preview de la dirección
          if (_previewAddress.isNotEmpty)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.all(16),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.green.shade50,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.green.shade200),
              ),
              child: Row(
                children: [
                  const Icon(Icons.preview_outlined, color: Colors.green, size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _previewAddress,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: Colors.green,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          
          // Formulario
          Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Tipo de vía + Número principal
                    Row(
                      children: [
                        Expanded(
                          flex: 2,
                          child: _buildDropdownField(
                            controller: _tipoViaCtrl,
                            label: 'Tipo de vía *',
                            items: _tiposVia,
                            validator: (v) => v?.isEmpty ?? true ? 'Requerido' : null,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          flex: 1,
                          child: _buildTextField(
                            controller: _numeroPrincipalCtrl,
                            label: 'Número *',
                            hint: '123',
                            keyboardType: TextInputType.number,
                            validator: (v) => v?.isEmpty ?? true ? 'Requerido' : null,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          flex: 1,
                          child: _buildTextField(
                            controller: _letraPrincipalCtrl,
                            label: 'Letra/Bis',
                            hint: 'A, BIS',
                            textCapitalization: TextCapitalization.characters,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    
                    // Cruce (#)
                    Row(
                      children: [
                        Expanded(
                          flex: 1,
                          child: _buildTextField(
                            controller: _numeroSecundarioCtrl,
                            label: 'Nº Cruce (#)',
                            hint: '45',
                            keyboardType: TextInputType.number,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          flex: 1,
                          child: _buildTextField(
                            controller: _letraSecundariaCtrl,
                            label: 'Letra cruce',
                            hint: '67',
                            textCapitalization: TextCapitalization.characters,
                          ),
                        ),
                        const SizedBox(width: 8),
                        const Expanded(
                          flex: 1,
                          child: SizedBox(), // Espaciador
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    
                    // Complemento
                    _buildTextField(
                      controller: _complementoCtrl,
                      label: 'Complemento',
                      hint: 'Ej: Apartamento, Interior, Oficina, Casa, Torre...',
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: _buildDropdownField(
                            controller: _complementoCtrl,
                            label: '',
                            items: _complementos,
                            isSecondary: true,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _buildTextField(
                            controller: _letraComplementoCtrl,
                            label: 'Nº/Letra complemento',
                            hint: '201, 3B, Local 5...',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    
                    // Barrio
                    _buildTextField(
                      controller: _barrioCtrl,
                      label: 'Barrio / Sector / Urbanización',
                      hint: 'Ej: El Poblado, Chapinero, Laureles...',
                    ),
                    const SizedBox(height: 16),
                    
                    // Ciudad + Departamento
                    Row(
                      children: [
                        Expanded(
                          child: _buildTextField(
                            controller: _ciudadCtrl,
                            label: 'Ciudad / Municipio *',
                            hint: 'Ej: Medellín, Bogotá, Cali...',
                            validator: (v) => v?.isEmpty ?? true ? 'Requerido' : null,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _buildDropdownField(
                            controller: _departamentoCtrl,
                            label: 'Departamento *',
                            items: _departamentos,
                            validator: (v) => v?.isEmpty ?? true ? 'Requerido' : null,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    
                    // Código postal + Alias
                    Row(
                      children: [
                        Expanded(
                          child: _buildTextField(
                            controller: _codigoPostalCtrl,
                            label: 'Código postal',
                            hint: '6 dígitos',
                            keyboardType: TextInputType.number,
                            maxLength: 6,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _buildTextField(
                            controller: _aliasCtrl,
                            label: 'Alias (opcional)',
                            hint: 'Casa, Oficina, Casa de mamá...',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    
                    // Referencia
                    _buildTextField(
                      controller: _referenciaCtrl,
                      label: 'Referencia adicional',
                      hint: 'Frente al parque, portería 2, zona rosa...',
                      maxLines: 2,
                    ),
                    const SizedBox(height: 16),
                    
                    // Checkbox default
                    CheckboxListTile(
                      value: _esDefault,
                      onChanged: (val) => setState(() => _esDefault = val ?? false),
                      title: const Text(
                        'Usar como dirección predeterminada',
                        style: TextStyle(fontWeight: FontWeight.w500),
                      ),
                      subtitle: const Text(
                        'Se autocompletará en el checkout',
                        style: TextStyle(fontSize: 12, color: Colors.grey),
                      ),
                      controlAffinity: ListTileControlAffinity.leading,
                      contentPadding: EdgeInsets.zero,
                      activeColor: AppTheme.primary,
                    ),
                    const SizedBox(height: 24),
                    
                    // Botones
                    Row(
                      children: [
                        if (widget.onCancel != null)
                          Expanded(
                            child: OutlinedButton(
                              onPressed: _isLoading ? null : widget.onCancel,
                              style: OutlinedButton.styleFrom(
                                padding: const EdgeInsets.symmetric(vertical: 14),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                              child: const Text('Cancelar'),
                            ),
                          ),
                        if (widget.onCancel != null) const SizedBox(width: 12),
                        Expanded(
                          child: ElevatedButton(
                            onPressed: _isLoading ? null : _save,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppTheme.primary,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            ),
                            child: _isLoading
                              ? const SizedBox(
                                  width: 20, height: 20,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                )
                              : Text(widget.initialAddress != null ? 'Actualizar' : 'Guardar dirección'),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String label,
    String? hint,
    TextInputType? keyboardType,
    TextCapitalization textCapitalization = TextCapitalization.words,
    String? Function(String?)? validator,
    int maxLines = 1,
    int? maxLength,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: AppTheme.text,
              ),
            ),
          ),
        TextFormField(
          controller: controller,
          keyboardType: keyboardType,
          textCapitalization: textCapitalization,
          validator: validator,
          maxLines: maxLines,
          maxLength: maxLength,
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: TextStyle(color: Colors.grey.shade400, fontSize: 13),
            filled: true,
            fillColor: Colors.grey.shade50,
            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(color: Colors.grey.shade200),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(color: Colors.grey.shade200),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: AppTheme.primary, width: 1.5),
            ),
            errorBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: Colors.red, width: 1.5),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildDropdownField({
    required TextEditingController controller,
    required String label,
    required List<String> items,
    String? Function(String?)? validator,
    bool isSecondary = false,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: AppTheme.text,
              ),
            ),
          ),
        DropdownButtonFormField<String>(
          initialValue: controller.text.isEmpty ? null : controller.text,
          items: items.map((item) => DropdownMenuItem(
            value: item,
            child: Text(item, style: const TextStyle(fontSize: 13)),
          )).toList(),
          onChanged: (value) {
            if (value != null) {
              controller.text = value;
              _updatePreview();
            }
          },
          validator: validator,
          decoration: InputDecoration(
            filled: true,
            fillColor: Colors.grey.shade50,
            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(color: Colors.grey.shade200),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(color: Colors.grey.shade200),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: AppTheme.primary, width: 1.5),
            ),
          ),
          isExpanded: true,
          menuMaxHeight: 300,
        ),
      ],
    );
  }
}

// Función helper para mostrar el builder en un dialog/bottom sheet
Future<void> showColombianAddressBuilder({
  required BuildContext context,
  Map<String, dynamic>? initialAddress,
  required Function(Map<String, dynamic>) onSave,
}) async {
  if (MediaQuery.of(context).size.width < 600) {
    // Móvil: bottom sheet
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.9,
        maxChildSize: 0.95,
        minChildSize: 0.5,
        expand: false,
        builder: (context, scrollController) => Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: ColombianAddressBuilder(
            initialAddress: initialAddress,
            onSave: onSave,
            onCancel: () => Navigator.pop(context),
          ),
        ),
      ),
    );
  } else {
    // Desktop: dialog
    await showDialog(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: Colors.transparent,
        insetPadding: const EdgeInsets.all(24),
        child: ColombianAddressBuilder(
          initialAddress: initialAddress,
          onSave: (data) {
            onSave(data);
            Navigator.pop(context);
          },
          onCancel: () => Navigator.pop(context),
        ),
      ),
    );
  }
}