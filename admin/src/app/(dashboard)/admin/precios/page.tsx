'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { formatPrecio } from '@/lib/format';
import { 
  DollarSign, 
  Search, 
  Download, 
  Upload, 
  AlertTriangle, 
  CheckCircle, 
  FileSpreadsheet, 
  RefreshCw, 
  Sliders, 
  Edit3, 
  Save, 
  X, 
  Info, 
  History, 
  Layers 
} from 'lucide-react';

interface PrecioItem {
  lista: 'cliente' | 'profesional' | 'negocio';
  precio: number | null;
  unidad_minima: number;
  incluye_iva: boolean;
}

interface ProductoPrecioRow {
  producto_id: number;
  sku: string | null;
  nombre: string;
  costo: number | null;
  stock: number;
  precios: {
    cliente?: PrecioItem;
    profesional?: PrecioItem;
    negocio?: PrecioItem;
  };
  avisos?: string[];
}

/**
 * Contrato REAL de GET /api/admin/precios/coherencia
 * (backend/src/controllers/adminPreciosController.js:545-551).
 * Devuelve 5 arrays, no contadores. Antes se declaraba otra forma
 * (campos sin_precio_* e incoherencias) que el backend nunca envio: al pasar
 * la peticion por el proxy BFF empezo a responder OK y leer
 * `incoherencias.length` reventaba la pagina con
 * "Cannot read properties of undefined (reading 'length')".
 */
interface CoherenciaReport {
  profesional_mayor_o_igual_que_cliente: Array<{ producto_id: number; profesional: number; cliente: number }>;
  negocio_mayor_que_profesional: Array<{ producto_id: number; negocio: number; profesional: number }>;
  precio_bajo_costo: Array<{ producto_id: number; costo: number; cliente: number | null; profesional: number | null; negocio: number | null }>;
  sin_costo_cargado: Array<{ producto_id: number; nombre: string }>;
  producto_sin_precio_en_lista: Array<{ producto_id: number; cliente: number | null; profesional: number | null; negocio: number | null }>;
}

function asArrayField<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Normaliza la respuesta del endpoint. Una forma inesperada degrada a listas
 * vacias en vez de tumbar el render.
 */
function normalizarCoherencia(raw: unknown): CoherenciaReport {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    profesional_mayor_o_igual_que_cliente: asArrayField(r.profesional_mayor_o_igual_que_cliente),
    negocio_mayor_que_profesional: asArrayField(r.negocio_mayor_que_profesional),
    precio_bajo_costo: asArrayField(r.precio_bajo_costo),
    sin_costo_cargado: asArrayField(r.sin_costo_cargado),
    producto_sin_precio_en_lista: asArrayField(r.producto_sin_precio_en_lista),
  };
}

function tieneAvisosCoherencia(c: CoherenciaReport): boolean {
  return (
    c.producto_sin_precio_en_lista.length > 0 ||
    c.precio_bajo_costo.length > 0 ||
    c.profesional_mayor_o_igual_que_cliente.length > 0 ||
    c.negocio_mayor_que_profesional.length > 0 ||
    c.sin_costo_cargado.length > 0
  );
}

interface HistorialItem {
  id: number;
  producto_id: number;
  producto_nombre: string;
  lista_codigo: string;
  lista_nombre: string;
  precio_anterior: number | null;
  precio_nuevo: number;
  actor_nombre: string | null;
  origen: string;
  motivo: string | null;
  fecha_cambio: string;
}

export default function AdminPreciosPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [productos, setProductos] = useState<ProductoPrecioRow[]>([]);
  const [coherencia, setCoherencia] = useState<CoherenciaReport | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'todos' | 'cliente' | 'profesional' | 'negocio'>('todos');

  // Estado para Historial
  const [showHistorialModal, setShowHistorialModal] = useState(false);
  const [historialItems, setHistorialItems] = useState<HistorialItem[]>([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);

  // Estado para Edición Manual
  const [editingProduct, setEditingProduct] = useState<ProductoPrecioRow | null>(null);
  const [editCosto, setEditCosto] = useState<string>('');
  const [editPrecioCliente, setEditPrecioCliente] = useState<string>('');
  const [editPrecioProf, setEditPrecioProf] = useState<string>('');
  const [editPrecioNegocio, setEditPrecioNegocio] = useState<string>('');
  const [editUnidadMinimaNegocio, setEditUnidadMinimaNegocio] = useState<string>('6');
  const [editMotivo, setEditMotivo] = useState<string>('Actualización desde Panel Admin');

  // Referencia porcentual informativa (no bloqueante)
  const [refPorcentaje, setRefPorcentaje] = useState<string>('');

  // Estado para Edición Masiva (Bulk) con Vista Previa
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkLista, setBulkLista] = useState<'cliente' | 'profesional' | 'negocio'>('cliente');
  // Los valores son EXACTAMENTE los `tipo` que acepta el backend
  // (adminPreciosController.bulkUpdatePrecios): porcentaje | fijar | delta. La pagina
  // usaba 'monto_fijo', que el endpoint rechaza con 400, y calculaba el precio en el
  // navegador en vez de pedirle la vista previa al servidor (el mismo codigo que luego
  // escribe), de modo que el preview podia no coincidir con el efecto real.
  const [bulkOperacion, setBulkOperacion] = useState<'porcentaje' | 'fijar' | 'delta'>('porcentaje');
  const [bulkValor, setBulkValor] = useState<string>('10');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkPreviewRows, setBulkPreviewRows] = useState<Array<{
    producto_id: number;
    nombre: string;
    precio_actual: number | null;
    precio_nuevo: number;
  }>>([]);

  // Estado para Importación CSV
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDryRun, setImportDryRun] = useState(true);
  const [importResult, setImportResult] = useState<{
    nuevos?: number;
    modificados?: number;
    sin_cambio?: number;
    errores?: string[];
  } | null>(null);

  // Paginacion del listado. El backend YA devolvia { total, pagina, filas }, pero la
  // pagina pedia sin parametros: se quedaba en la pagina 1 con el tope de por_pagina
  // (50) y ORDER BY id ASC, asi que todo producto a partir del 51 era invisible —y
  // parecia que Gestion de Precios no tuviera productos que si estaban en el catalogo.
  const [pagina, setPagina] = useState(1);
  const [totalProductos, setTotalProductos] = useState(0);
  const POR_PAGINA = 50;

  // Helper para headers con CSRF token via BFF proxy
  const getBffHeaders = () => ({
    'X-Requested-With': 'XMLHttpRequest'
  });

  const fetchPreciosData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getBffHeaders();

      const [resPrecios, resCoherencia] = await Promise.all([
        fetch(`/api/admin/precios?page=${pagina}&por_pagina=${POR_PAGINA}`, { headers }),
        fetch('/api/admin/precios/coherencia', { headers })
      ]);

      if (!resPrecios.ok) {
        throw new Error(`Error obteniendo precios: HTTP ${resPrecios.status}`);
      }

      const dataPrecios = await resPrecios.json();
      setProductos(dataPrecios.filas || dataPrecios.data || []);
      setTotalProductos(Number(dataPrecios.total) || 0);

      if (resCoherencia.ok) {
        const dataCoherencia = await resCoherencia.json();
        setCoherencia(normalizarCoherencia(dataCoherencia));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error desconocido de red';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [pagina]);

  useEffect(() => {
    fetchPreciosData();
  }, [fetchPreciosData]);

  const fetchHistorialData = useCallback(async () => {
    setLoadingHistorial(true);
    try {
      const headers = getBffHeaders();
      const res = await fetch('/api/admin/precios/historial', { headers });
      if (res.ok) {
        const data = await res.json();
        setHistorialItems(data.filas || []);
      }
    } catch (err: unknown) {
      console.error('Error al obtener historial de precios:', err);
    } finally {
      setLoadingHistorial(false);
    }
  }, []);

  // Manejo de Edición Manual
  const handleOpenEdit = (prod: ProductoPrecioRow) => {
    setEditingProduct(prod);
    setEditCosto(prod.costo !== null ? String(prod.costo) : '');
    setEditPrecioCliente(prod.precios.cliente?.precio !== null && prod.precios.cliente?.precio !== undefined ? String(prod.precios.cliente.precio) : '');
    setEditPrecioProf(prod.precios.profesional?.precio !== null && prod.precios.profesional?.precio !== undefined ? String(prod.precios.profesional.precio) : '');
    setEditPrecioNegocio(prod.precios.negocio?.precio !== null && prod.precios.negocio?.precio !== undefined ? String(prod.precios.negocio.precio) : '');
    setEditUnidadMinimaNegocio(prod.precios.negocio?.unidad_minima ? String(prod.precios.negocio.unidad_minima) : '6');
    setEditMotivo('Actualización manual desde Panel Admin');
    setRefPorcentaje('');
  };

  // Cálculo Informativo de porcentaje de margen sobre costo (No Bloqueante)
  const handleCalcRefPorcentaje = (pctStr: string) => {
    setRefPorcentaje(pctStr);
    const pct = parseFloat(pctStr);
    const costoNum = parseFloat(editCosto);
    if (!isNaN(pct) && !isNaN(costoNum) && costoNum > 0) {
      const sugerido = costoNum * (1 + pct / 100);
      if (!editPrecioCliente) setEditPrecioCliente(sugerido.toFixed(2));
      if (!editPrecioProf) setEditPrecioProf(sugerido.toFixed(2));
      if (!editPrecioNegocio) setEditPrecioNegocio((sugerido * 0.85).toFixed(2));
    }
  };

  const handleSaveManualEdit = async () => {
      if (!editingProduct) return;
      try {
        const headers = getBffHeaders();
        const preciosArray: Array<{ lista: 'cliente' | 'profesional' | 'negocio'; precio: number | null; unidad_minima?: number }> = [];

        if (editPrecioCliente !== '') preciosArray.push({ lista: 'cliente', precio: parseFloat(editPrecioCliente) });
        if (editPrecioProf !== '') preciosArray.push({ lista: 'profesional', precio: parseFloat(editPrecioProf) });
        if (editPrecioNegocio !== '') {
          preciosArray.push({
            lista: 'negocio',
            precio: parseFloat(editPrecioNegocio),
            unidad_minima: parseInt(editUnidadMinimaNegocio, 10) || 6
          });
        }

        const payload = {
          costo: editCosto !== '' ? parseFloat(editCosto) : null,
          precios: preciosArray,
          motivo: editMotivo
        };

        const res = await fetch(`/api/admin/precios/${editingProduct.producto_id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...headers
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.message || `Error al guardar: HTTP ${res.status}`);
        }

        setSuccessMsg(`Precio del producto "${editingProduct.nombre}" actualizado correctamente.`);
        setEditingProduct(null);
        fetchPreciosData();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Error al guardar cambios';
        setError(message);
      }
    };

    // Generar Vista Previa Masiva (Bulk Preview)
    const handleGenerateBulkPreview = async () => {
      const val = parseFloat(bulkValor);
      if (isNaN(val)) {
        setError('Ingrese un valor numérico válido para el ajuste masivo.');
        return;
      }

      // La vista previa la calcula el SERVIDOR, no el navegador: `preview: true` es un
      // dry-run del mismo codigo que luego escribe, asi que el preview no puede mentir
      // sobre el efecto ni sobre a que productos alcanza. Antes la pagina recalculaba
      // los precios por su cuenta y enviaba otro formato, que el endpoint rechazaba.
      try {
        setError(null);
        setBulkLoading(true);

        const res = await fetch('/api/admin/precios/bulk', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...getBffHeaders()
          },
          body: JSON.stringify({
            lista: bulkLista,
            producto_ids: productos.map(p => p.producto_id),
            operacion: { tipo: bulkOperacion, valor: val },
            preview: true
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Error generando la vista previa: HTTP ${res.status}`);
        }

        const data = await res.json();
        const nombres = new Map(productos.map(p => [p.producto_id, p.nombre]));
        const detalle = Array.isArray(data.detalle) ? data.detalle : [];

        setBulkPreviewRows(detalle.map((d: { producto_id: number; antes: number | null; despues: number }) => ({
          producto_id: d.producto_id,
          nombre: nombres.get(d.producto_id) || `#${d.producto_id}`,
          precio_actual: d.antes,
          precio_nuevo: d.despues
        })));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error generando la vista previa del ajuste masivo');
      } finally {
        setBulkLoading(false);
      }
    };

    // Aplicar Cambios Masivos Confirmados
    const handleApplyBulkChanges = async () => {
      try {
        const headers = getBffHeaders();
        // Formato que adminPreciosController.bulkUpdatePrecios realmente acepta:
        // { lista, producto_ids, operacion: { tipo, valor }, motivo }. La version
        // anterior mandaba un arreglo llamado "cambios" con el precio ya calculado
        // en el navegador, formato que el endpoint rechaza con 400: por eso el
        // ajuste masivo NUNCA funciono.
        const payload = {
          lista: bulkLista,
          producto_ids: bulkPreviewRows.map(r => r.producto_id),
          operacion: { tipo: bulkOperacion, valor: parseFloat(bulkValor) },
          motivo: `Ajuste masivo ${bulkOperacion} (${bulkValor})`
        };

        const res = await fetch('/api/admin/precios/bulk', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...headers
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.message || `Error en actualización masiva: HTTP ${res.status}`);
        }

        setSuccessMsg(`Ajuste masivo de precios aplicado exitosamente.`);
        setShowBulkModal(false);
        setBulkPreviewRows([]);
        fetchPreciosData();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Error al aplicar cambios masivos';
        setError(message);
      }
    };

  // Exportar CSV
  const handleExportCsv = async () => {
    try {
      const headers = getBffHeaders();
      const res = await fetch('/api/admin/precios/export.csv', { headers });
      if (!res.ok) {
        throw new Error(`Exportación falló: HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'precios_glowshop.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al exportar CSV';
      setError(message);
    }
  };

  // Importar CSV
  const handleImportCsv = async () => {
    if (!importFile) {
      setError('Seleccione un archivo CSV para importar.');
      return;
    }

    try {
      const headers = getBffHeaders();
      const formData = new FormData();
      formData.append('archivo', importFile);
      formData.append('dryRun', importDryRun ? 'true' : 'false');

      const res = await fetch('/api/admin/precios/import.csv', {
        method: 'POST',
        headers,
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error importando archivo CSV');
      }

      setImportResult(data);
      if (!importDryRun) {
        setSuccessMsg('Precios aplicados desde archivo CSV correctamente.');
        fetchPreciosData();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error procesando archivo CSV';
      setError(message);
    }
  };

  // Filtrado de productos por búsqueda y pestaña
  const filteredProducts = productos.filter(p => {
    const matchesSearch = p.nombre.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (p.sku && p.sku.toLowerCase().includes(searchQuery.toLowerCase()));
    
    if (!matchesSearch) return false;

    if (activeTab === 'cliente') return p.precios.cliente?.precio !== undefined;
    if (activeTab === 'profesional') return p.precios.profesional?.precio !== undefined;
    if (activeTab === 'negocio') return p.precios.negocio?.precio !== undefined;

    return true;
  });

  return (
    <div className="p-8 space-y-8 bg-slate-950 min-h-screen text-slate-100">
      {/* Header de Página */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900/80 p-6 rounded-2xl border border-slate-800 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-3">
            <div className="bg-rose-500/10 p-3 rounded-xl border border-rose-500/20 text-rose-400">
              <DollarSign size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Administración de Precios GlowShop</h1>
              <p className="text-sm text-slate-400">Gestión de tarifas por nivel (Consumidor, Profesional, Salón) e importación masiva</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => { setShowHistorialModal(true); fetchHistorialData(); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-purple-400 border border-purple-500/20 rounded-xl text-sm font-medium transition-all"
          >
            <History size={16} />
            Historial
          </button>
          <button
            onClick={fetchPreciosData}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-sm font-medium transition-all"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/20 rounded-xl text-sm font-medium transition-all"
          >
            <Download size={16} />
            Exportar CSV
          </button>
          <button
            onClick={() => { setShowImportModal(true); setImportResult(null); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-sky-400 border border-sky-500/20 rounded-xl text-sm font-medium transition-all"
          >
            <Upload size={16} />
            Importar CSV
          </button>
          <button
            onClick={() => { setShowBulkModal(true); setBulkPreviewRows([]); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-rose-600/20"
          >
            <Sliders size={16} />
            Ajuste Masivo
          </button>
        </div>
      </div>

      {/* Alertas de Notificación */}
      {error && (
        <div className="flex items-center justify-between p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-sm">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200"><X size={18} /></button>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center justify-between p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-sm">
          <div className="flex items-center gap-3">
            <CheckCircle size={20} className="text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-200"><X size={18} /></button>
        </div>
      )}

      {/* Reporte de Coherencia Comercial (Informativo, No Bloqueante) */}
      {coherencia && tieneAvisosCoherencia(coherencia) && (
        <div className="p-5 bg-amber-500/10 border border-amber-500/30 rounded-2xl space-y-3">
          <div className="flex items-center gap-3 text-amber-400 font-semibold text-sm">
            <Info size={18} />
            <span>Avisos de Coherencia Comercial (Informativos)</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 text-xs text-amber-200/80">
            <div className="bg-amber-950/40 p-3 rounded-xl border border-amber-500/20">
              <span className="font-semibold text-amber-300">{coherencia.producto_sin_precio_en_lista.length}</span> sin tarifa en alguna lista
            </div>
            <div className="bg-amber-950/40 p-3 rounded-xl border border-amber-500/20">
              <span className="font-semibold text-amber-300">{coherencia.precio_bajo_costo.length}</span> por debajo del costo
            </div>
            <div className="bg-amber-950/40 p-3 rounded-xl border border-amber-500/20">
              <span className="font-semibold text-amber-300">{coherencia.profesional_mayor_o_igual_que_cliente.length}</span> donde Profesional ≥ Consumidor
            </div>
            <div className="bg-amber-950/40 p-3 rounded-xl border border-amber-500/20">
              <span className="font-semibold text-amber-300">{coherencia.negocio_mayor_que_profesional.length}</span> donde Salón &gt; Profesional
            </div>
            <div className="bg-amber-950/40 p-3 rounded-xl border border-amber-500/20">
              <span className="font-semibold text-amber-300">{coherencia.sin_costo_cargado.length}</span> sin costo cargado
            </div>
          </div>
        </div>
      )}

      {/* Barra de Filtros y Búsqueda */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div className="flex items-center gap-2 bg-slate-800/80 px-3.5 py-2 rounded-xl border border-slate-700/60 w-full sm:w-80">
          <Search size={18} className="text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por producto o SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-sm text-slate-100 placeholder-slate-400 focus:outline-none w-full"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
          {(['todos', 'cliente', 'profesional', 'negocio'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all whitespace-nowrap ${
                activeTab === tab
                  ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >
              {tab === 'todos' ? 'Todos los Productos' : tab === 'cliente' ? 'Consumidor' : tab === 'profesional' ? 'Profesional' : 'Salón (Min 6)'}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla Principal de Catálogo de Precios por Nivel */}
      <div className="bg-slate-900/80 rounded-2xl border border-slate-800 overflow-hidden backdrop-blur-sm shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-800/90 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-700/60">
              <tr>
                <th className="py-4 px-6">SKU / Producto</th>
                <th className="py-4 px-4 text-right">Costo Base</th>
                <th className="py-4 px-4 text-center">Consumidor (IVA incl.)</th>
                <th className="py-4 px-4 text-center">Profesional B2B</th>
                <th className="py-4 px-4 text-center">Salón (Unidad Mínima 6)</th>
                <th className="py-4 px-6 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-rose-500" />
                    Cargando catálogo de precios por nivel...
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    No se encontraron productos que coincidan con la búsqueda.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((prod) => {
                  const pCliente = prod.precios.cliente?.precio;
                  const pProf = prod.precios.profesional?.precio;
                  const pNegocio = prod.precios.negocio?.precio;
                  const uMinNegocio = prod.precios.negocio?.unidad_minima || 6;

                  return (
                    <tr key={prod.producto_id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-4 px-6">
                        <div className="font-semibold text-slate-100">{prod.nombre}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>SKU: {prod.sku || 'SIN-SKU'}</span>
                          <span>•</span>
                          <span>Stock: {prod.stock}</span>
                        </div>
                      </td>

                      <td className="py-4 px-4 text-right font-mono text-slate-300">
                        {prod.costo !== null ? formatPrecio(prod.costo) : <span className="text-slate-600">-</span>}
                      </td>

                      {/* Nivel Consumidor */}
                      <td className="py-4 px-4 text-center">
                        {pCliente !== undefined && pCliente !== null ? (
                          <span className="font-mono font-medium text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-lg border border-emerald-500/20">
                            ${formatPrecio(pCliente)}
                          </span>
                        ) : (
                          <span className="text-xs text-rose-400/80 bg-rose-500/10 px-2.5 py-1 rounded-lg border border-rose-500/20 font-medium">
                            Sin Precio
                          </span>
                        )}
                      </td>

                      {/* Nivel Profesional */}
                      <td className="py-4 px-4 text-center">
                        {pProf !== undefined && pProf !== null ? (
                          <span className="font-mono font-medium text-sky-400 bg-sky-500/10 px-3 py-1 rounded-lg border border-sky-500/20">
                            ${formatPrecio(pProf)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
                            Sin Precio
                          </span>
                        )}
                      </td>

                      {/* Nivel Salón */}
                      <td className="py-4 px-4 text-center">
                        {pNegocio !== undefined && pNegocio !== null ? (
                          <div className="inline-flex flex-col items-center">
                            <span className="font-mono font-medium text-purple-400 bg-purple-500/10 px-3 py-1 rounded-lg border border-purple-500/20">
                              ${formatPrecio(pNegocio)}
                            </span>
                            <span className="text-[10px] text-purple-300/70 mt-1">Min: {uMinNegocio} unid.</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
                            Sin Precio
                          </span>
                        )}
                      </td>

                      <td className="py-4 px-6 text-right">
                        <button
                          onClick={() => handleOpenEdit(prod)}
                          className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all border border-transparent hover:border-rose-500/20"
                          title="Editar Precios de Producto"
                        >
                          <Edit3 size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginacion: sin esto solo se veian los primeros 50 productos y el resto
            era inalcanzable, aunque el backend ya devolvia el total. */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 border-t border-slate-800">
          <p className="text-sm text-slate-400">
            Mostrando {productos.length === 0 ? 0 : ((pagina - 1) * POR_PAGINA) + 1} - {Math.min(pagina * POR_PAGINA, totalProductos)} de {totalProductos} productos
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPagina(p => Math.max(1, p - 1))}
              disabled={pagina <= 1 || loading}
              className="btn btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Anterior
            </button>
            <span className="text-sm text-slate-400">
              Página {pagina} de {Math.max(1, Math.ceil(totalProductos / POR_PAGINA))}
            </span>
            <button
              type="button"
              onClick={() => setPagina(p => p + 1)}
              disabled={pagina >= Math.ceil(totalProductos / POR_PAGINA) || loading}
              className="btn btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>

      {/* MODAL DE EDICIÓN MANUAL DE PRECIO */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-6 space-y-6 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white">Editar Precios — {editingProduct.nombre}</h3>
                <p className="text-xs text-slate-400">SKU: {editingProduct.sku || 'N/A'}</p>
              </div>
              <button onClick={() => setEditingProduct(null)} className="text-slate-400 hover:text-white"><X size={20} /></button>
            </div>

            {/* Referencia Porcentual Informativa (No Bloqueante) */}
            <div className="p-4 bg-slate-850 bg-slate-800/40 rounded-xl border border-slate-700/60 space-y-2">
              <label className="text-xs font-semibold text-rose-300 flex items-center gap-2">
                <Info size={14} /> Margen Informativo de Referencia (% estimado sobre costo)
              </label>
              <input
                type="number"
                placeholder="Ej. 30 (para +30% estimado)"
                value={refPorcentaje}
                onChange={(e) => handleCalcRefPorcentaje(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
              />
              <p className="text-[11px] text-slate-400">
                Esta regla porcentual es sólo una estimación sugerida y no restringe la colocación manual del valor deseado.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Costo Base ($)</label>
                <input
                  type="number"
                  value={editCosto}
                  onChange={(e) => setEditCosto(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-rose-500 font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-emerald-400 block mb-1">Consumidor (IVA incl.) ($)</label>
                <input
                  type="number"
                  value={editPrecioCliente}
                  onChange={(e) => setEditPrecioCliente(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-sky-400 block mb-1">Profesional B2B ($)</label>
                <input
                  type="number"
                  value={editPrecioProf}
                  onChange={(e) => setEditPrecioProf(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500 font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-purple-400 block mb-1">Salón B2B ($)</label>
                <input
                  type="number"
                  value={editPrecioNegocio}
                  onChange={(e) => setEditPrecioNegocio(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-purple-500 font-mono"
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-xs text-purple-300 block mb-1">Unidad Mínima Salón (Exclusiva Venta Salones)</label>
                <input
                  type="number"
                  value={editUnidadMinimaNegocio}
                  onChange={(e) => setEditUnidadMinimaNegocio(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-purple-500 font-mono"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  El mínimo de 6 unidades aplica únicamente a la lista de salones de belleza. En Consumidor y Profesional siempre es 1.
                </p>
              </div>

              <div className="md:col-span-2">
                <label className="text-xs text-slate-400 block mb-1">Motivo de Auditoría</label>
                <input
                  type="text"
                  value={editMotivo}
                  onChange={(e) => setEditMotivo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                onClick={() => setEditingProduct(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveManualEdit}
                className="flex items-center gap-2 px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-rose-600/20"
              >
                <Save size={16} />
                Guardar Precios
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE AJUSTE MASIVO CON VISTA PREVIA OBLIGATORIA */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 space-y-6 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Sliders size={20} className="text-rose-500" />
                Ajuste Masivo de Precios (Vista Previa Requerida)
              </h3>
              <button onClick={() => setShowBulkModal(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Lista Destino</label>
                <select
                  value={bulkLista}
                  onChange={(e) => setBulkLista(e.target.value as 'cliente' | 'profesional' | 'negocio')}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                >
                  <option value="cliente">Consumidor</option>
                  <option value="profesional">Profesional</option>
                  <option value="negocio">Salón</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Tipo de Ajuste</label>
                <select
                  value={bulkOperacion}
                  onChange={(e) => setBulkOperacion(e.target.value as 'porcentaje' | 'fijar' | 'delta')}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                >
                  <option value="porcentaje">Porcentaje (%) — varía el precio en ese %</option>
                  <option value="fijar">Fijar precio ($) — pone ese precio a todos</option>
                  <option value="delta">Sumar / restar monto ($)</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Valor de Incremento</label>
                <input
                  type="number"
                  value={bulkValor}
                  onChange={(e) => setBulkValor(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono"
                />
              </div>
            </div>

            <button
              onClick={handleGenerateBulkPreview}
              disabled={bulkLoading}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-rose-400 border border-rose-500/20 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {bulkLoading ? 'Calculando en el servidor…' : 'Generar Vista Previa de Cambios'}
            </button>

            {/* TABLA DE VISTA PREVIA PROPUESTA */}
            {bulkPreviewRows.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-300">
                  Vista previa del servidor · {bulkPreviewRows.length} de {productos.length} productos de esta página ({totalProductos} en el catálogo):
                </p>
                <div className="max-h-60 overflow-y-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-800 text-slate-400 sticky top-0">
                      <tr>
                        <th className="py-2 px-3">Producto</th>
                        <th className="py-2 px-3 text-right">Precio Actual</th>
                        <th className="py-2 px-3 text-right">Precio Nuevo Propuesto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {bulkPreviewRows.slice(0, 50).map((r) => (
                        <tr key={r.producto_id}>
                          <td className="py-2 px-3">{r.nombre}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-400">
                            {formatPrecio(r.precio_actual)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-emerald-400 font-bold">
                            ${formatPrecio(r.precio_nuevo)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => setShowBulkModal(false)}
                    className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-sm font-medium"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleApplyBulkChanges}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-emerald-600/20"
                  >
                    Confirmar y Aplicar Cambios Masivos
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL DE IMPORTACIÓN CSV */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-6 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <FileSpreadsheet size={20} className="text-sky-400" />
                Importar Precios desde Archivo CSV
              </h3>
              <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
            </div>

            {/* REGLA FORZOSA DE NEGOCIO */}
            <div className="p-4 bg-sky-500/10 border border-sky-500/30 rounded-xl text-xs text-sky-200 space-y-1">
              <p className="font-bold flex items-center gap-1 text-sky-300">
                <Info size={14} /> Regla de Importación CSV:
              </p>
              <p>
                <strong>Una celda vacía en el CSV significa &quot;no tocar ese precio&quot;</strong>.
                Los precios existentes no serán borrados ni sobrescritos por celdas vacías.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Seleccionar archivo CSV</label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-300 bg-slate-950 border border-slate-700 rounded-xl p-2.5"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="dryRunCheck"
                  checked={importDryRun}
                  onChange={(e) => setImportDryRun(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-rose-500 focus:ring-rose-500"
                />
                <label htmlFor="dryRunCheck" className="text-xs text-slate-300 cursor-pointer">
                  Modo Simulador (Dry Run) — Evalúa el archivo sin modificar la base de datos
                </label>
              </div>

              <button
                onClick={handleImportCsv}
                className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-sky-600/20"
              >
                {importDryRun ? 'Simular Importación' : 'Aplicar Precios Definitivos'}
              </button>
            </div>

            {/* RESULTADO DE IMPORTACIÓN */}
            {importResult && (
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2 text-xs">
                <p className="font-semibold text-slate-200">Resultado del Procesamiento:</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-emerald-500/10 p-2 rounded-lg text-emerald-400 font-bold">
                    Nuevos: {importResult.nuevos || 0}
                  </div>
                  <div className="bg-sky-500/10 p-2 rounded-lg text-sky-400 font-bold">
                    Modificados: {importResult.modificados || 0}
                  </div>
                  <div className="bg-slate-800 p-2 rounded-lg text-slate-400 font-bold">
                    Sin Cambio: {importResult.sin_cambio || 0}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL DE HISTORIAL DE AUDITORÍA DE PRECIOS */}
      {showHistorialModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl p-6 space-y-6 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <History size={20} className="text-purple-400" />
                Historial de Auditoría de Precios
              </h3>
              <button onClick={() => setShowHistorialModal(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
            </div>

            <div className="max-h-96 overflow-y-auto border border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-800 text-slate-400 sticky top-0">
                  <tr>
                    <th className="py-2.5 px-4">Fecha / Hora</th>
                    <th className="py-2.5 px-4">Producto</th>
                    <th className="py-2.5 px-4">Lista</th>
                    <th className="py-2.5 px-4 text-right">Precio Anterior</th>
                    <th className="py-2.5 px-4 text-right">Precio Nuevo</th>
                    <th className="py-2.5 px-4">Origen / Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {loadingHistorial ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-purple-400" />
                        Cargando historial de cambios...
                      </td>
                    </tr>
                  ) : historialItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        No hay registros en el historial de precios.
                      </td>
                    </tr>
                  ) : (
                    historialItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-4 font-mono text-slate-400">
                          {new Date(item.fecha_cambio).toLocaleString('es-CO')}
                        </td>
                        <td className="py-2.5 px-4 font-medium text-slate-200">{item.producto_nombre}</td>
                        <td className="py-2.5 px-4 uppercase font-semibold text-purple-300">{item.lista_codigo}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-slate-400">
                          {formatPrecio(item.precio_anterior)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-400">
                          ${formatPrecio(item.precio_nuevo)}
                        </td>
                        <td className="py-2.5 px-4 text-slate-400">
                          <div>{item.origen}</div>
                          {item.actor_nombre && <div className="text-[10px] text-slate-500">{item.actor_nombre}</div>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowHistorialModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECCIÓN INFORMATIVA DE AUDITORÍA DE HISTORIAL */}
      <div className="p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-3">
          <History size={18} className="text-slate-500" />
          <span>Historial de Auditoría: Todos los cambios de precios quedan registrados de forma inmutable en <code className="text-slate-300">precios_historial</code>.</span>
        </div>
        <span className="text-slate-500 font-mono">FK ON DELETE RESTRICT Protegido</span>
      </div>
    </div>
  );
}
