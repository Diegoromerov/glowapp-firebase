'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, RotateCcw, ExternalLink, AlertTriangle, Truck } from 'lucide-react';

const STATUSES = ['SOLICITADA', 'ETIQUETA_GENERADA', 'ENVIADA', 'EN_TRANSITO_RETORNO', 'RECIBIDA_PROVEEDOR', 'INSPECCIONADA', 'APROBADA', 'RECHAZADA', 'REEMBOLSADA', 'CAMBIADA', 'CERRADA'];
const LABELS: Record<string, string> = {
  SOLICITADA: 'Solicitada', ETIQUETA_GENERADA: 'Etiqueta generada', ENVIADA: 'Enviada',
  EN_TRANSITO_RETORNO: 'En tránsito de retorno', RECIBIDA_PROVEEDOR: 'Recibida por proveedor',
  INSPECCIONADA: 'Inspeccionada', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada',
  REEMBOLSADA: 'Reembolsada', CAMBIADA: 'Cambiada', CERRADA: 'Cerrada',
};

interface ReturnRequest {
  id: string;
  pedido_id: string;
  estado: string;
  motivo: string;
  descripcion: string | null;
  items: unknown[] | string;
  carrier_retorno: string | null;
  guia_retorno: string | null;
  guia_retorno_tracking_url: string | null;
  etiqueta_retorno_pdf_url: string | null;
  reembolso_estado: string | null;
  reembolso_monto_cop: number | string | null;
  monto_reembolso: number | string | null;
  inspeccion_estado: string | null;
  inspeccion_notas: string | null;
  solicitada_en: string;
  actualizado_en: string | null;
  nombre_entrega: string | null;
  pedido_total: number | string;
  cliente_nombre: string | null;
  cliente_email: string | null;
  proveedor_nombre: string | null;
  proveedor_email: string | null;
}

export default function AdminStoreReturnsPage() {
  const [rows, setRows] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setAvailable(false);
    setError('');
    try {
      const query = new URLSearchParams({ page: String(page), limit: '30' });
      if (status) query.set('estado', status);
      const response = await fetch(`/api/admin/returns?${query}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No fue posible cargar las devoluciones.');
      if (body.success !== true || !Array.isArray(body.data)) throw new Error('La respuesta de devoluciones no tiene el formato esperado.');
      setRows(body.data);
      setPages(Math.max(1, Number(body.pagination?.pages) || 1));
      setAvailable(true);
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : 'Error al consultar devoluciones.');
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => { void load(); }, [load]);

  const money = (value: number | string | null) => value == null ? '—' : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const date = (value: string | null) => value ? new Date(value).toLocaleString('es-CO') : '—';
  const itemSummary = (value: ReturnRequest['items']) => {
    try {
      const items = typeof value === 'string' ? JSON.parse(value) : value;
      if (!Array.isArray(items)) return 'Detalle no disponible';
      return items.map((item: { producto_id?: number | string; cantidad?: number | string }) => `${item.cantidad || '?'} × producto ${item.producto_id || '?'}`).join(', ') || 'Sin productos';
    } catch {
      return 'Detalle no disponible';
    }
  };

  return (
    <main className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Devoluciones GlowStore</h1>
          <p className="mt-1 text-gray-500">Seguimiento central de solicitudes, retornos y reembolsos.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/logistics" className="btn btn-tertiary flex items-center gap-2"><Truck className="h-4 w-4" />Envíos</Link>
          <button onClick={() => void load()} disabled={loading} className="btn btn-secondary flex items-center gap-2"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Actualizar</button>
        </div>
      </header>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        Esta bandeja es de seguimiento administrativo. La aprobación, rechazo e inspección permanecen a cargo del proveedor; el reembolso se muestra como pendiente hasta que exista integración con el procesador de pagos.
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</div>}

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <label className="block max-w-sm text-sm font-medium text-gray-700">Estado de la devolución
          <select className="input mt-1 w-full" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
            <option value="">Todos los estados</option>
            {STATUSES.map((value) => <option key={value} value={value}>{LABELS[value]}</option>)}
          </select>
        </label>
      </section>

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {loading ? <div className="p-10 text-center text-gray-500">Cargando devoluciones…</div> : !available ? (
          <div className="p-10 text-center text-red-700"><AlertTriangle className="mx-auto mb-3 h-9 w-9" />No fue posible consultar devoluciones; no podemos confirmar que la bandeja esté vacía.</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-gray-500"><RotateCcw className="mx-auto mb-3 h-9 w-9 text-gray-300" />No hay devoluciones para los filtros seleccionados.</div>
        ) : <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr>
              <th className="px-4 py-3">Solicitud / pedido</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Proveedor</th><th className="px-4 py-3">Motivo / productos</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Retorno</th><th className="px-4 py-3">Reembolso</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">{rows.map((row) => (
              <tr key={row.id} className="align-top hover:bg-gray-50">
                <td className="px-4 py-3"><div className="font-mono">#{row.pedido_id.slice(0, 8).toUpperCase()}</div><div className="text-xs text-gray-500">Solicitud {date(row.solicitada_en)}</div><div className="text-xs text-gray-500">Total pedido: {money(row.pedido_total)}</div></td>
                <td className="px-4 py-3">{row.cliente_nombre || row.nombre_entrega || '—'}<div className="text-xs text-gray-500">{row.cliente_email || ''}</div></td>
                <td className="px-4 py-3">{row.proveedor_nombre || 'Sin asignar'}<div className="text-xs text-gray-500">{row.proveedor_email || ''}</div></td>
                <td className="px-4 py-3"><div className="font-medium">{row.motivo}</div><div className="max-w-xs whitespace-pre-wrap text-xs text-gray-700">{itemSummary(row.items)}</div><div className="max-w-xs whitespace-pre-wrap text-xs text-gray-500">{row.descripcion || 'Sin descripción'}</div></td>
                <td className="px-4 py-3"><span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium">{LABELS[row.estado] || row.estado}</span>{row.inspeccion_estado && <div className="mt-1 text-xs text-gray-500">Inspección: {row.inspeccion_estado}</div>}</td>
                <td className="px-4 py-3">{row.carrier_retorno || 'Sin transportadora'}<div className="text-xs text-gray-500">Guía: {row.guia_retorno || 'pendiente'}</div>{row.guia_retorno_tracking_url && <a className="mt-1 inline-flex items-center gap-1 text-blue-700" href={row.guia_retorno_tracking_url} target="_blank" rel="noreferrer">Rastrear <ExternalLink className="h-3 w-3" /></a>}{row.etiqueta_retorno_pdf_url && <a className="ml-3 inline-flex items-center gap-1 text-blue-700" href={row.etiqueta_retorno_pdf_url} target="_blank" rel="noreferrer">Etiqueta <ExternalLink className="h-3 w-3" /></a>}</td>
                <td className="px-4 py-3">{money(row.reembolso_monto_cop ?? row.monto_reembolso)}<div className="text-xs text-gray-500">{row.reembolso_estado || 'Sin reembolso registrado'}</div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>}
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
          <span>Página {page} de {pages}</span><div className="flex gap-2">
            <button className="btn btn-tertiary" disabled={page <= 1 || loading} onClick={() => setPage((n) => Math.max(1, n - 1))}>Anterior</button>
            <button className="btn btn-tertiary" disabled={page >= pages || loading} onClick={() => setPage((n) => Math.min(pages, n + 1))}>Siguiente</button>
          </div>
        </div>
      </section>
    </main>
  );
}
