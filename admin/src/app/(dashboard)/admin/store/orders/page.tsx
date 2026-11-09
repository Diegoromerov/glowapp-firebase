'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Package,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Truck,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Eye,
  Loader2,
  Calendar,
  MapPin,
  CreditCard,
  DollarSign,
  MoreVertical,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';

interface Pedido {
  id: string;
  comprador_id: number;
  comprador_email: string;
  first_name: string;
  last_name: string;
  rol_comprador: string;
  booking_id: string | null;
  prestador_comisionado_id: number | null;
  comision_total_prestador: string;
  subtotal: string;
  envio: string;
  iva: string;
  total: string;
  estado: 'PENDIENTE_PAGO' | 'PAGADO' | 'DESPACHADO' | 'ENTREGADO' | 'CANCELADO';
  nombre_entrega: string;
  direccion_entrega: string;
  creado_en: string;
  pagado_en: string | null;
  despachado_en: string | null;
  entregado_en: string | null;
  cancelado_en: string | null;
  cufe: string | null;
  qr_factura: string | null;
  factura_emitida: boolean;
  factura_fecha: string | null;
  // Opcionales (vienen en GET /admin/store/orders con detalles o en listado básico)
  items?: Array<{
    id: string;
    producto_id: number;
    cantidad: number;
    precio_unitario_pagado: string;
    comision_unitaria_prestador: string;
    nombre: string;
    imagen_url: string;
    tag_especialidad: string;
  }>;
}

interface Envio {
  id: string;
  pedido_id: string;
  transportadora: string;
  guia: string;
  url_rastreo: string | null;
  estado: string;
  creado_en: string;
  actualizado_en: string;
  entregado_en: string | null;
  observaciones: string | null;
}

interface OrderDetail {
  order: Pedido;
  items: Array<{
    id: string;
    pedido_id: string;
    producto_id: number;
    cantidad: number;
    precio_unitario_pagado: string;
    comision_unitaria_prestador: string;
    nombre: string;
    imagen_url: string;
    tag_especialidad: string;
  }>;
}

const STATUS_CONFIG = {
  PENDIENTE_PAGO: { label: 'Pendiente de pago', color: 'bg-amber-100 text-amber-800', icon: AlertTriangle },
  PAGADO: { label: 'Pagado', color: 'bg-blue-100 text-blue-800', icon: CreditCard },
  DESPACHADO: { label: 'Despachado', color: 'bg-yellow-100 text-yellow-800', icon: Truck },
  ENTREGADO: { label: 'Entregado', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  CANCELADO: { label: 'Cancelado', color: 'bg-red-100 text-red-800', icon: XCircle },
} as const;

const ENVIO_STATUS_CONFIG = {
  CREADO: { label: 'Creado', color: 'bg-gray-100 text-gray-800' },
  RECOGIDO: { label: 'Recogido', color: 'bg-blue-100 text-blue-800' },
  EN_TRANSITO: { label: 'En tránsito', color: 'bg-yellow-100 text-yellow-800' },
  EN_CENTRO_DESTINO: { label: 'En centro destino', color: 'bg-orange-100 text-orange-800' },
  SALIDA_ENTREGA: { label: 'Salida para entrega', color: 'bg-purple-100 text-purple-800' },
  ENTREGADO: { label: 'Entregado', color: 'bg-green-100 text-green-800' },
  FALLIDO: { label: 'Fallido', color: 'bg-red-100 text-red-800' },
  DEVUELTO: { label: 'Devuelto', color: 'bg-gray-100 text-gray-800' },
} as const;

export default function AdminStoreOrdersPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 20;

  // Filtros
  const [estadoFilter, setEstadoFilter] = useState<string>('');
  const [desdeFilter, setDesdeFilter] = useState<string>('');
  const [hastaFilter, setHastaFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modales
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedPedido, setSelectedPedido] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [dispatchOrderId, setDispatchOrderId] = useState<string | null>(null);
  const [dispatchForm, setDispatchForm] = useState({
    transportadora: '',
    guia: '',
    url_rastreo: '',
    observaciones: '',
  });
  const [dispatchLoading, setDispatchLoading] = useState(false);

  const [showDeliverModal, setShowDeliverModal] = useState(false);
  const [deliverOrderId, setDeliverOrderId] = useState<string | null>(null);
  const [deliverForm, setDeliverForm] = useState({ observaciones: '' });
  const [deliverLoading, setDeliverLoading] = useState(false);

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelForm, setCancelForm] = useState({ motivo: '' });
  const [cancelLoading, setCancelLoading] = useState(false);

  const getBffHeaders = (contentType = 'application/json') => ({
    'X-Requested-With': 'XMLHttpRequest',
    ...(contentType ? { 'Content-Type': contentType } : {}),
  });

  const buildQueryParams = () => {
    const params = new URLSearchParams();
    params.append('page', currentPage.toString());
    params.append('limit', pageSize.toString());
    if (estadoFilter) params.append('estado', estadoFilter);
    if (desdeFilter) params.append('desde', desdeFilter);
    if (hastaFilter) params.append('hasta', hastaFilter);
    return params.toString();
  };

  const fetchPedidos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getBffHeaders();
      const res = await fetch(`/api/admin/store/orders?${buildQueryParams()}`, { headers });
      if (!res.ok) throw new Error('Error al obtener pedidos');
      const data = await res.json();
      setPedidos(data.data || []);
      setTotalCount(data.total || 0);
      setTotalPages(Math.ceil((data.total || 0) / pageSize));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, [currentPage, estadoFilter, desdeFilter, hastaFilter]);

  useEffect(() => {
    fetchPedidos();
  }, [fetchPedidos]);

  const fetchOrderDetail = async (orderId: string, order: Pedido) => {
    setDetailLoading(true);
    setSelectedPedido({ order, items: [] });
    setShowDetailModal(true);
    try {
      const headers = getBffHeaders();
      const res = await fetch(`/api/store/orders/${orderId}`, { headers });
      if (!res.ok) throw new Error('Error al obtener detalle del pedido');
      const data = await res.json();
      setSelectedPedido(data.data);
    } catch (e) {
      setShowDetailModal(false);
      setSelectedPedido(null);
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchOrderId) return;
    setDispatchLoading(true);
    try {
      const headers = getBffHeaders();
      const res = await fetch(`/api/admin/store/orders/${dispatchOrderId}/dispatch`, {
        method: 'POST',
        headers,
        body: JSON.stringify(dispatchForm),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error al despachar');
      }
      setSuccessMsg('Pedido despachado correctamente');
      setShowDispatchModal(false);
      setDispatchForm({ transportadora: '', guia: '', url_rastreo: '', observaciones: '' });
      fetchPedidos();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setDispatchLoading(false);
    }
  };

  const handleDeliver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliverOrderId) return;
    setDeliverLoading(true);
    try {
      const headers = getBffHeaders();
      const res = await fetch(`/api/admin/store/orders/${deliverOrderId}/deliver`, {
        method: 'POST',
        headers,
        body: JSON.stringify(deliverForm),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error al marcar como entregado');
      }
      setSuccessMsg('Pedido marcado como entregado');
      setShowDeliverModal(false);
      setDeliverForm({ observaciones: '' });
      fetchPedidos();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setDeliverLoading(false);
    }
  };

  const handleCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelOrderId) return;
    setCancelLoading(true);
    try {
      const headers = getBffHeaders();
      const res = await fetch(`/api/admin/store/orders/${cancelOrderId}/cancel`, {
        method: 'POST',
        headers,
        body: JSON.stringify(cancelForm),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error al cancelar');
      }
      setSuccessMsg('Pedido cancelado');
      setShowCancelModal(false);
      setCancelForm({ motivo: '' });
      fetchPedidos();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setCancelLoading(false);
    }
  };

  const openDispatchModal = (order: Pedido) => {
    setDispatchOrderId(order.id);
    setDispatchForm({ transportadora: '', guia: '', url_rastreo: '', observaciones: '' });
    setShowDispatchModal(true);
  };

  const openDeliverModal = (order: Pedido) => {
    setDeliverOrderId(order.id);
    setDeliverForm({ observaciones: '' });
    setShowDeliverModal(true);
  };

  const openCancelModal = (order: Pedido) => {
    setCancelOrderId(order.id);
    setCancelForm({ motivo: '' });
    setShowCancelModal(true);
  };

  const formatCurrency = (val: string | number) => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(num);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    try {
      return format(new Date(dateStr), 'dd/MM/yyyy HH:mm', { locale: es });
    } catch {
      return dateStr;
    }
  };

  const getStatusConfig = (estado: string) => STATUS_CONFIG[estado as keyof typeof STATUS_CONFIG] || { label: estado, color: 'bg-gray-100 text-gray-800', icon: AlertTriangle };

  const getEnvioStatusConfig = (estado: string) => ENVIO_STATUS_CONFIG[estado as keyof typeof ENVIO_STATUS_CONFIG] || { label: estado, color: 'bg-gray-100 text-gray-800' };

  const clearMessages = () => {
    setError(null);
    setSuccessMsg(null);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pedidos GlowStore</h1>
          <p className="text-gray-500 mt-1">Gestión de pedidos, despacho y entrega</p>
        </div>
        <button
          onClick={() => { clearMessages(); fetchPedidos(); }}
          disabled={loading}
          className="btn btn-secondary flex items-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button onClick={clearMessages} className="text-red-500 hover:text-red-700">✕</button>
        </div>
      )}
      {successMsg && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={clearMessages} className="text-green-500 hover:text-green-700">✕</button>
        </div>
      )}

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Buscar (ID, email, nombre)</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchPedidos()}
                placeholder="Buscar..."
                className="input pl-10 w-full"
              />
            </div>
          </div>

          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
            <select
              value={estadoFilter}
              onChange={(e) => setEstadoFilter(e.target.value)}
              className="input"
            >
              <option value="">Todos</option>
              <option value="PENDIENTE_PAGO">Pendiente de pago</option>
              <option value="PAGADO">Pagado</option>
              <option value="DESPACHADO">Despachado</option>
              <option value="ENTREGADO">Entregado</option>
              <option value="CANCELADO">Cancelado</option>
            </select>
          </div>

          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Desde</label>
            <input
              type="date"
              value={desdeFilter}
              onChange={(e) => setDesdeFilter(e.target.value)}
              className="input"
            />
          </div>

          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Hasta</label>
            <input
              type="date"
              value={hastaFilter}
              onChange={(e) => setHastaFilter(e.target.value)}
              className="input"
            />
          </div>

          <button
            onClick={() => { setEstadoFilter(''); setDesdeFilter(''); setHastaFilter(''); setSearchQuery(''); fetchPedidos(); }}
            className="btn btn-tertiary h-10"
          >
            <Filter className="h-4 w-4 mr-2" /> Limpiar
          </button>
        </div>
      </div>

      {/* Tabla de pedidos */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading && pedidos.length === 0 ? (
          <div className="p-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">Cargando pedidos...</p>
          </div>
        ) : pedidos.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No hay pedidos con los filtros actuales</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Pedido</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Cliente</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Items</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Fecha</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pedidos.map((pedido) => {
                    const statusCfg = getStatusConfig(pedido.estado);
                    const StatusIcon = statusCfg.icon;
                    const itemCount = pedido.items?.length || 0;
                    return (
                      <tr key={pedido.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-mono text-sm text-gray-900">#{pedido.id.slice(0, 8).toUpperCase()}</div>
                          <div className="text-xs text-gray-500">{pedido.rol_comprador}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{pedido.first_name} {pedido.last_name}</div>
                          <div className="text-sm text-gray-500">{pedido.comprador_email}</div>
                          <div className="text-xs text-gray-400 flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {pedido.direccion_entrega.slice(0, 50)}...
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-gray-700">{itemCount} producto{itemCount !== 1 ? 's' : ''}</span>
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-900">{formatCurrency(pedido.total)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${statusCfg.color}`}>
                            <StatusIcon className="h-3 w-3" />
                            {statusCfg.label}
                          </span>
                          {pedido.envio && pedido.estado !== 'PENDIENTE_PAGO' && (
                            <div className="mt-1 text-xs text-gray-500">Envío: ${parseFloat(pedido.envio).toLocaleString('es-CO')}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatDate(pedido.creado_en)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => fetchOrderDetail(pedido.id, pedido)}
                              className="btn btn-tertiary p-2"
                              title="Ver detalle"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            {pedido.estado === 'PAGADO' && (
                              <button
                                onClick={() => openDispatchModal(pedido)}
                                className="btn btn-primary p-2"
                                title="Despachar"
                              >
                                <Truck className="h-4 w-4" />
                              </button>
                            )}
                            {(pedido.estado === 'DESPACHADO' || pedido.estado === 'PAGADO') && (
                              <button
                                onClick={() => openDeliverModal(pedido)}
                                className="btn btn-success p-2"
                                title="Marcar entregado"
                              >
                                <CheckCircle className="h-4 w-4" />
                              </button>
                            )}
                            {![ 'ENTREGADO', 'CANCELADO' ].includes(pedido.estado) && (
                              <button
                                onClick={() => openCancelModal(pedido)}
                                className="btn btn-danger p-2"
                                title="Cancelar"
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Mostrando {((currentPage - 1) * pageSize) + 1} a {Math.min(currentPage * pageSize, totalCount)} de {totalCount} pedidos
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="btn btn-tertiary p-2"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="px-3 text-sm text-gray-700">Página {currentPage} de {totalPages}</span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="btn btn-tertiary p-2"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showDetailModal && selectedPedido && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto">
          <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-gray-200 p-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  Pedido #{selectedPedido.order.id.slice(0, 8).toUpperCase()}
                </h2>
                <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${getStatusConfig(selectedPedido.order.estado).color}`}>
                  {getStatusConfig(selectedPedido.order.estado).label}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowDetailModal(false); setSelectedPedido(null); }}
                className="btn btn-tertiary"
              >
                Cerrar
              </button>
            </div>

            {detailLoading ? (
              <div className="p-10 text-center">
                <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-gray-400" />
                <p className="text-gray-500">Cargando detalle del pedido...</p>
              </div>
            ) : (
              <div className="max-h-[75vh] space-y-6 overflow-y-auto p-6">
                <section className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Comprador</h3>
                    <p className="mt-1 text-sm text-gray-700">
                      {selectedPedido.order.first_name} {selectedPedido.order.last_name}
                    </p>
                    <p className="text-sm text-gray-500">{selectedPedido.order.comprador_email}</p>
                    <p className="mt-1 text-sm text-gray-500">Creado: {formatDate(selectedPedido.order.creado_en)}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Entrega</h3>
                    <p className="mt-1 text-sm text-gray-700">{selectedPedido.order.nombre_entrega}</p>
                    <p className="text-sm text-gray-500">{selectedPedido.order.direccion_entrega}</p>
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 text-sm font-semibold text-gray-900">Productos</h3>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                        <tr>
                          <th className="px-3 py-2">Producto</th>
                          <th className="px-3 py-2">Cantidad</th>
                          <th className="px-3 py-2">Precio unitario</th>
                          <th className="px-3 py-2">Comisión unitaria</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(selectedPedido.items ?? []).map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 py-3">
                              <div className="font-medium text-gray-900">{item.nombre}</div>
                              <div className="text-xs text-gray-500">{item.tag_especialidad}</div>
                            </td>
                            <td className="px-3 py-3 text-gray-700">{item.cantidad}</td>
                            <td className="px-3 py-3 text-gray-700">{formatCurrency(item.precio_unitario_pagado)}</td>
                            <td className="px-3 py-3 text-gray-700">{formatCurrency(item.comision_unitaria_prestador)}</td>
                          </tr>
                        ))}
                        {(selectedPedido.items ?? []).length === 0 && (
                          <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-500">No hay productos en este pedido.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="ml-auto max-w-sm space-y-2 border-t border-gray-200 pt-4 text-sm">
                  <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatCurrency(selectedPedido.order.subtotal)}</span></div>
                  <div className="flex justify-between text-gray-600"><span>Envío</span><span>{formatCurrency(selectedPedido.order.envio)}</span></div>
                  <div className="flex justify-between text-gray-600"><span>IVA</span><span>{formatCurrency(selectedPedido.order.iva)}</span></div>
                  <div className="flex justify-between border-t border-gray-200 pt-2 font-bold text-gray-900"><span>Total</span><span>{formatCurrency(selectedPedido.order.total)}</span></div>
                </section>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
