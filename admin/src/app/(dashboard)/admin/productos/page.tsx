'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { formatPrecio } from '@/lib/format';
import {
  Package,
  Plus,
  Search,
  Edit3,
  Trash2,
  Image,
  DollarSign,
  Tag,
  Save,
  X,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Upload,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface Producto {
  id: number;
  nombre: string;
  descripcion: string;
  // NULL-able en la base: la migracion 071 anade la columna sin NOT NULL
  costo: string | null;
  stock: number;
  imagen_url: string;
  tag_especialidad: string;
  tipo_visibilidad: string;
  sku: string | null;
  tenant_id: number;
}

interface PrecioItem {
  lista: 'cliente' | 'profesional' | 'negocio';
  precio: number;
  unidad_minima: number;
}

interface Categoria {
  id: number;
  nombre: string;
}

export default function AdminProductosPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalogoDisponible, setCatalogoDisponible] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 20;

  // Estado para Modal de Crear/Editar
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Producto | null>(null);
  const [formData, setFormData] = useState({
    nombre: '',
    descripcion: '',
    costo: '',
    stock: '',
    imagen_url: '',
    tag_especialidad: '',
    tipo_visibilidad: 'PUBLICO',
    sku: '',
    categoria_id: '',
  });
  const [precios, setPrecios] = useState<PrecioItem[]>([
    { lista: 'cliente', precio: 0, unidad_minima: 1 },
    { lista: 'profesional', precio: 0, unidad_minima: 1 },
    { lista: 'negocio', precio: 0, unidad_minima: 6 },
  ]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Pagination
  const [totalCount, setTotalCount] = useState(0);

  // Helper para headers con CSRF token via BFF proxy
  const getBffHeaders = (contentType = 'application/json') => ({
    'X-Requested-With': 'XMLHttpRequest',
    ...(contentType ? { 'Content-Type': contentType } : {}),
  });

  const fetchProductos = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCatalogoDisponible(false);
    try {
      const headers = getBffHeaders();
      const res = await fetch(`/api/admin/products?page=${currentPage}&limit=${pageSize}`, { headers });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `Error HTTP ${res.status}`);
      }

      const data = await res.json();
      const filas = data.data ?? data.filas;
      const total = data.total ?? data.count;
      if (!Array.isArray(filas) || !Number.isFinite(Number(total))) throw new Error('Respuesta inválida del catálogo de productos');
      setProductos(filas);
      setTotalCount(Number(total));
      setTotalPages(Math.ceil(Number(total) / pageSize));
      setCatalogoDisponible(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      setError(message);
      setProductos([]);
      setTotalCount(0);
      setCatalogoDisponible(false);
    } finally {
      setLoading(false);
    }
  }, [currentPage]);

  const fetchCategorias = useCallback(async () => {
    try {
      const headers = getBffHeaders();
      const res = await fetch('/api/categorias', { headers });
      if (res.ok) {
        const data = await res.json();
        setCategorias(data.data || data.categorias || []);
      }
    } catch (err) {
      console.error('Error fetching categorias:', err);
    }
  }, []);

  useEffect(() => {
    fetchProductos();
    fetchCategorias();
  }, [fetchProductos, fetchCategorias]);

  // Handlers
  const handleOpenCreate = () => {
    setEditingProduct(null);
    setFormData({
      nombre: '',
      descripcion: '',
      costo: '',
      stock: '',
      imagen_url: '',
      tag_especialidad: '',
      tipo_visibilidad: 'PUBLICO',
      sku: '',
      categoria_id: '',
    });
    setPrecios([
      { lista: 'cliente', precio: 0, unidad_minima: 1 },
      { lista: 'profesional', precio: 0, unidad_minima: 1 },
      { lista: 'negocio', precio: 0, unidad_minima: 6 },
    ]);
    setImagePreview(null);
    setShowModal(true);
  };

  const handleOpenEdit = (prod: Producto) => {
    setEditingProduct(prod);
    setFormData({
      nombre: prod.nombre,
      descripcion: prod.descripcion,
      costo: prod.costo !== null ? String(prod.costo) : '',
      stock: String(prod.stock),
      imagen_url: prod.imagen_url,
      tag_especialidad: prod.tag_especialidad,
      tipo_visibilidad: prod.tipo_visibilidad,
      sku: prod.sku || '',
      categoria_id: '',
    });
    setImagePreview(prod.imagen_url);
    // Fetch precios for this product
    fetchPrecios(prod.id);
    setShowModal(true);
  };

  const fetchPrecios = async (productoId: number) => {
    // Se vacia ANTES de pedir: si la peticion fallara, el estado no puede quedarse con
    // los precios del producto ANTERIOR. El guardado solo envia precios > 0, asi que
    // heredar valores ajenos los escribiria encima de ESTE producto.
    setPrecios([
      { lista: 'cliente', precio: 0, unidad_minima: 1 },
      { lista: 'profesional', precio: 0, unidad_minima: 1 },
      { lista: 'negocio', precio: 0, unidad_minima: 6 },
    ]);
    try {
      const headers = getBffHeaders();
      const res = await fetch(`/api/admin/precios/${productoId}`, { headers });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setPrecios([
        { lista: 'cliente', precio: data.precios?.cliente || 0, unidad_minima: data.unidad_minima?.cliente || 1 },
        { lista: 'profesional', precio: data.precios?.profesional || 0, unidad_minima: data.unidad_minima?.profesional || 1 },
        { lista: 'negocio', precio: data.precios?.negocio || 0, unidad_minima: data.unidad_minima?.negocio || 6 },
      ]);
    } catch (err) {
      console.error('Error fetching precios:', err);
      setError('No se pudieron cargar los precios por perfil de este producto. Se muestran vacíos: revisá antes de guardar.');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handlePrecioChange = (lista: string, field: 'precio' | 'unidad_minima', value: string) => {
    setPrecios(prev => prev.map(p => 
      p.lista === lista ? { ...p, [field]: field === 'precio' ? parseFloat(value) || 0 : parseInt(value) || 0 } : p
    ));
  };

  // Image Upload to R2
  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('El archivo debe ser una imagen');
      return;
    }

    setUploadingImage(true);
    setError(null);

    try {
      const headers = getBffHeaders();

      // 1. Get presigned URL via BFF proxy
      const presignedRes = await fetch('/api/admin/upload/presigned', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          folder: 'products'
        })
      });

      if (!presignedRes.ok) {
        const err = await presignedRes.json();
        throw new Error(err.message || 'Error obteniendo URL de subida');
      }

      const presignedData = await presignedRes.json();
      const { uploadUrl, key } = presignedData.data;

      // 2. Upload directly to R2 (not via proxy)
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file
      });

      if (!uploadRes.ok) {
        throw new Error('Error subiendo imagen a R2');
      }

      // 3. Confirm upload via BFF proxy
      const confirmRes = await fetch('/api/admin/upload/confirm', {
        method: 'POST',
        headers,
        body: JSON.stringify({ key })
      });

      if (!confirmRes.ok) {
        const err = await confirmRes.json();
        throw new Error(err.message || 'Error confirmando subida');
      }

      const confirmData = await confirmRes.json();
      const finalUrl = confirmData.data.cdnUrl || confirmData.data.fileUrl;
      
      setFormData(prev => ({ ...prev, imagen_url: finalUrl }));
      setImagePreview(finalUrl);
      setSuccessMsg('Imagen subida correctamente a R2');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error subiendo imagen';
      setError(message);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImageUpload(file);
  };

  const handleSubmit = async () => {
    if (!formData.nombre || !formData.tag_especialidad || !formData.costo) {
      setError('Nombre, tag de especialidad y costo son obligatorios');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const isEdit = !!editingProduct;
      const url = isEdit 
        ? `/api/admin/products/${editingProduct.id}`
        : `/api/admin/products`;
      const method = isEdit ? 'PUT' : 'POST';

      const payload = {
        nombre: formData.nombre,
        descripcion: formData.descripcion,
        costo: parseFloat(formData.costo),
        stock: parseInt(formData.stock) || 0,
        imagen_url: formData.imagen_url,
        tag_especialidad: formData.tag_especialidad,
        tipo_visibilidad: formData.tipo_visibilidad,
        sku: formData.sku || null,
        categoria_id: formData.categoria_id ? parseInt(formData.categoria_id) : null,
      };

      const res = await fetch(url, {
        method,
        headers: getBffHeaders(),
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `Error ${res.status}`);
      }

      const savedProduct = await res.json();
      const productId = savedProduct.data?.id || savedProduct.id;

      // Save precios
      for (const p of precios) {
        if (p.precio > 0) {
          await fetch(`/api/admin/precios/${productId}`, {
            method: 'PUT',
            headers: getBffHeaders(),
            body: JSON.stringify({
              precios: [{
                lista: p.lista,
                precio: p.precio,
                unidad_minima: p.unidad_minima
              }]
            })
          });
        }
      }

      setSuccessMsg(isEdit ? 'Producto actualizado correctamente' : 'Producto creado correctamente');
      setShowModal(false);
      fetchProductos();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error guardando producto';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar este producto? Esta acción no se puede deshacer.')) return;

    try {
      const headers = getBffHeaders();
      const res = await fetch(`/api/admin/products/${id}`, {
        method: 'DELETE',
        headers
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error eliminando');
      }

      setSuccessMsg('Producto eliminado');
      fetchProductos();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error eliminando';
      setError(message);
    }
  };

  const filteredProducts = productos.filter(p =>
    p.nombre.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.sku && p.sku.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="p-8 space-y-8 bg-[#f7f5f0] min-h-screen text-[#2b2420]">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl border border-[#e8e1d7] backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-3">
            <div className="bg-rose-500/10 p-3 rounded-xl border border-rose-500/20 text-rose-400">
              <Package size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#2b2420]">Catálogo de Productos GlowShop</h1>
              <p className="text-sm text-[#71685f]">CRUD completo + Subida de imágenes a R2 + Precios multi-nivel</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={fetchProductos} disabled={loading} className="flex items-center gap-2 px-4 py-2.5 bg-[#f2eee8] hover:bg-[#e8e1d7] text-[#403a35] rounded-xl text-sm font-medium transition-all">
            <Loader2 size={16} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
          <button onClick={handleOpenCreate} className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-rose-600/20">
            <Plus size={18} />
            Nuevo Producto
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center justify-between p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-800 text-sm">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-800"><X size={18} /></button>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center justify-between p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-800 text-sm">
          <div className="flex items-center gap-3">
            <CheckCircle size={20} className="text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-800"><X size={18} /></button>
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-[#fbfaf8] p-4 rounded-xl border border-[#e8e1d7]">
        <div className="flex items-center gap-2 bg-[#f7f5f0] px-3.5 py-2 rounded-xl border border-[#e8e1d7] w-full sm:w-80">
          <Search size={18} className="text-[#71685f]" />
          <input
            type="text"
            placeholder="Buscar por nombre o SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-sm text-[#2b2420] placeholder-[#8a8178] focus:outline-none w-full"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-[#71685f]">
          <span>{catalogoDisponible ? `Página ${currentPage} de ${totalPages || 1} • ${totalCount} productos` : 'Catálogo no disponible'}</span>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-2xl border border-[#e8e1d7] overflow-hidden backdrop-blur-sm shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-[#403a35]">
            <thead className="bg-[#f2eee8] text-xs text-[#71685f] uppercase tracking-wider border-b border-[#e8e1d7]">
              <tr>
                <th className="py-4 px-6">Imagen</th>
                <th className="py-4 px-6">Producto</th>
                <th className="py-4 px-4">Categoría</th>
                <th className="py-4 px-4 text-right">Costo</th>
                <th className="py-4 px-4 text-center">Stock</th>
                <th className="py-4 px-4 text-center">Visibilidad</th>
                <th className="py-4 px-6 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e8e1d7]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#71685f]">
                    <Loader2 size={24} className="animate-spin mx-auto mb-2 text-rose-500" />
                    Cargando catálogo...
                  </td>
                </tr>
              ) : !catalogoDisponible ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#71685f]">
                    No se pudo consultar el catálogo; no es posible confirmar que esté vacío.
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#71685f]">
                    No se encontraron productos
                  </td>
                </tr>
              ) : (
                filteredProducts.map((prod) => (
                  <tr key={prod.id} className="hover:bg-[#f7f5f0] transition-colors">
                    <td className="py-4 px-6">
                      {prod.imagen_url ? (
                        <img 
                          src={prod.imagen_url} 
                          alt={prod.nombre}
                          className="w-16 h-16 object-cover rounded-lg border border-[#ded6cb]"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-16 h-16 bg-[#f2eee8] rounded-lg flex items-center justify-center border border-[#ded6cb]">
                          <Image size={24} className="text-[#8a8178]" />
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-6">
                      <div className="font-semibold text-[#2b2420]">{prod.nombre}</div>
                      <div className="text-xs text-[#8a8178] flex items-center gap-2 mt-0.5">
                        <span>SKU: {prod.sku || 'SIN-SKU'}</span>
                        <span>•</span>
                        <span>Tag: {prod.tag_especialidad}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span className="px-2 py-1 bg-[#f2eee8] rounded-lg text-xs text-[#403a35] border border-[#ded6cb]">
                        {categorias.find(c => c.id === parseInt(formData.categoria_id || '0'))?.nombre || 'N/A'}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-right font-mono text-[#403a35]">
                      {formatPrecio(prod.costo)}
                    </td>
                    <td className="py-4 px-4 text-center font-mono">
                      {prod.stock}
                    </td>
                    <td className="py-4 px-4 text-center">
                      <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                        prod.tipo_visibilidad === 'PUBLICO' 
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                      } border`}>
                        {prod.tipo_visibilidad}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenEdit(prod)}
                          className="p-2 text-[#71685f] hover:text-sky-400 hover:bg-sky-500/10 rounded-xl transition-all border border-transparent hover:border-sky-500/20"
                          title="Editar"
                        >
                          <Edit3 size={18} />
                        </button>
                        <button
                          onClick={() => handleDelete(prod.id)}
                          className="p-2 text-[#71685f] hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all border border-transparent hover:border-rose-500/20"
                          title="Eliminar"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-[#e8e1d7] flex items-center justify-between">
            <div className="text-sm text-[#71685f]">
              {catalogoDisponible ? `Mostrando ${((currentPage - 1) * pageSize) + 1} - ${Math.min(currentPage * pageSize, totalCount)} de ${totalCount}` : 'Catálogo no disponible'}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 bg-[#f2eee8] hover:bg-[#e8e1d7] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 bg-[#f2eee8] hover:bg-[#e8e1d7] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal Create/Edit */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-md p-4 overflow-y-auto">
          <div className="bg-white border border-[#e8e1d7] rounded-2xl w-full max-w-3xl p-6 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#e8e1d7] pb-4 sticky top-0 bg-white z-10">
              <div>
                <h3 className="text-lg font-bold text-[#2b2420]">
                  {editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
                </h3>
                <p className="text-xs text-[#71685f]">
                  {editingProduct ? `ID: ${editingProduct.id}` : 'Los campos con * son obligatorios'}
                </p>
              </div>
              <button onClick={() => setShowModal(false)} className="text-[#71685f] hover:text-[#2b2420]"><X size={24} /></button>
            </div>

            <div className="space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#71685f] block mb-1">Nombre *</label>
                  <input
                    type="text"
                    name="nombre"
                    value={formData.nombre}
                    onChange={handleInputChange}
                    className="w-full bg-[#f7f5f0] border border-[#ded6cb] rounded-xl px-3.5 py-2 text-sm text-[#2b2420] focus:outline-none focus:border-rose-500"
                    placeholder="Nombre del producto"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#71685f] block mb-1">SKU</label>
                  <input
                    type="text"
                    name="sku"
                    value={formData.sku}
                    onChange={handleInputChange}
                    className="w-full bg-[#f7f5f0] border border-[#ded6cb] rounded-xl px-3.5 py-2 text-sm text-[#2b2420] focus:outline-none focus:border-[#c9a45c] font-mono"
                    placeholder="Opcional"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#71685f] block mb-1">Tag Especialidad *</label>
                  <input
                    type="text"
                    name="tag_especialidad"
                    value={formData.tag_especialidad}
                    onChange={handleInputChange}
                    className="w-full bg-[#f7f5f0] border border-[#ded6cb] rounded-xl px-3.5 py-2 text-sm text-[#2b2420] focus:outline-none focus:border-rose-500"
                    placeholder="Ej: hair-diagnostic, nails-classic"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#71685f] block mb-1">Categoría</label>
                  <select
                    name="categoria_id"
                    value={formData.categoria_id}
                    onChange={handleInputChange}
                    className="w-full bg-[#f7f5f0] border border-[#ded6cb] rounded-xl px-3.5 py-2 text-sm text-[#2b2420] focus:outline-none focus:border-[#c9a45c]"
                  >
                    <option value="">Seleccionar...</option>
                    {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[#71685f] block mb-1">Costo Base ($) *</label>
                  <input
                    type="number"
                    name="costo"
                    value={formData.costo}
                    onChange={handleInputChange}
                    step="0.01"
                    min="0"
                    className="w-full bg-[#f7f5f0] border border-[#ded6cb] rounded-xl px-3.5 py-2 text-sm text-[#2b2420] focus:outline-none focus:border-rose-500 font-mono"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#71685f] block mb-1">Stock</label>
                  <input
                    type="number"
                    name="stock"
                    value={formData.stock}
                    onChange={handleInputChange}
                    min="0"
                    className="w-full bg-[#f7f5f0] border border-[#ded6cb] rounded-xl px-3.5 py-2 text-sm text-[#2b2420] focus:outline-none focus:border-[#c9a45c] font-mono"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#71685f] block mb-1">Visibilidad</label>
                  <select
                    name="tipo_visibilidad"
                    value={formData.tipo_visibilidad}
                    onChange={handleInputChange}
                    className="w-full bg-[#f7f5f0] border border-[#ded6cb] rounded-xl px-3.5 py-2 text-sm text-[#2b2420] focus:outline-none focus:border-[#c9a45c]"
                  >
                    <option value="PUBLICO">Público</option>
                    <option value="INSUMO_PRESTADOR">Insumo Prestador</option>
                    <option value="PRIVADO">Privado</option>
                  </select>
                </div>
              </div>

              {/* Descripción */}
              <div>
                <label className="text-xs text-[#71685f] block mb-1">Descripción</label>
                <textarea
                  name="descripcion"
                  value={formData.descripcion}
                  onChange={handleInputChange}
                  rows={3}
                  className="w-full bg-[#f7f5f0] border border-[#ded6cb] rounded-xl px-3.5 py-2 text-sm text-[#2b2420] focus:outline-none focus:border-[#c9a45c] resize-none"
                  placeholder="Descripción del producto..."
                />
              </div>

              {/* Image Upload */}
              <div className="space-y-4 p-4 bg-slate-850/50 rounded-xl border border-[#e8e1d7]">
                <label className="text-xs font-semibold text-[#403a35] flex items-center gap-2">
                  <Image size={14} /> Imagen del Producto (R2/CDN)
                </label>
                
                <div className="flex items-center gap-4">
                  <div className="relative w-32 h-32 flex-shrink-0 bg-[#f2eee8] rounded-xl border border-[#ded6cb] overflow-hidden">
                    {imagePreview ? (
                      <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#8a8178]">
                        <Image size={32} />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-medium cursor-pointer transition-all">
                      <Upload size={16} />
                      Subir Imagen
                      <input type="file" accept="image/*" onChange={handleFileSelect} className="hidden" disabled={uploadingImage} />
                    </label>
                    {uploadingImage && (
                      <div className="flex items-center gap-2 text-xs text-rose-400">
                        <Loader2 size={14} className="animate-spin" />
                        Subiendo a R2...
                      </div>
                    )}
                    {formData.imagen_url && !uploadingImage && (
                      <p className="text-xs text-[#71685f] font-mono truncate max-w-xs">
                        {formData.imagen_url}
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-[#71685f]">
                  La imagen se sube directamente a Cloudflare R2 (bucket: glowapp-products) vía URL presignada.
                  Se sirve públicamente desde: <code className="text-[#403a35]">pub-d4cc152248c743a4a5feacbccfa6d33b.r2.dev</code>
                </p>
              </div>

              {/* Precios Multi-nivel */}
              <div className="space-y-4 p-4 bg-slate-850/50 rounded-xl border border-[#e8e1d7]">
                <label className="text-xs font-semibold text-[#403a35] flex items-center gap-2">
                  <DollarSign size={14} /> Precios por Nivel (opcional - se pueden agregar después en /admin/precios)
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {precios.map((p, idx) => (
                    <div key={p.lista} className={`p-4 rounded-xl border ${idx === 0 ? 'border-emerald-500/30 bg-emerald-500/5' : idx === 1 ? 'border-sky-500/30 bg-sky-500/5' : 'border-purple-500/30 bg-purple-500/5'}`}>
                      <label className="text-xs font-semibold block mb-2 flex items-center gap-1">
                        {p.lista === 'cliente' && <span className="text-emerald-400">●</span>}
                        {p.lista === 'profesional' && <span className="text-sky-400">●</span>}
                        {p.lista === 'negocio' && <span className="text-purple-400">●</span>}
                        {p.lista.charAt(0).toUpperCase() + p.lista.slice(1)} 
                        {p.lista === 'negocio' && <Tag size={12} className="text-[10px]" />}
                      </label>
                      <div className="space-y-2">
                        <div>
                          <label className="text-[11px] text-[#71685f] block mb-0.5">Precio ($)</label>
                          <input
                            type="number"
                            value={p.precio || ''}
                            onChange={(e) => handlePrecioChange(p.lista, 'precio', e.target.value)}
                            step="0.01"
                            min="0"
                            className="w-full bg-[#f7f5f0] border border-[#ded6cb] rounded-lg px-3 py-1.5 text-sm text-[#2b2420] focus:outline-none focus:border-rose-500 font-mono"
                            placeholder="0.00"
                          />
                        </div>
                        {p.lista === 'negocio' && (
                          <div>
                            <label className="text-[11px] text-[#71685f] block mb-0.5">Unidad Mínima</label>
                            <input
                              type="number"
                              value={p.unidad_minima}
                              onChange={(e) => handlePrecioChange(p.lista, 'unidad_minima', e.target.value)}
                              min="1"
                              className="w-full bg-[#f7f5f0] border border-[#ded6cb] rounded-lg px-3 py-1.5 text-sm text-[#2b2420] focus:outline-none focus:border-purple-500 font-mono"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-[#e8e1d7] sticky bottom-0 bg-white backdrop-blur-sm">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-[#f2eee8] hover:bg-[#e8e1d7] text-[#403a35] rounded-xl text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-rose-600/20 disabled:opacity-50"
              >
                <Save size={16} />
                {editingProduct ? 'Actualizar Producto' : 'Crear Producto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
