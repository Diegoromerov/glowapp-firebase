'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Truck, ExternalLink, AlertTriangle, CheckCircle2 } from 'lucide-react';

const STATUS = ['CREADO', 'RECOGIDO', 'EN_TRANSITO', 'EN_CENTRO_DESTINO', 'SALIDA_ENTREGA', 'ENTREGADO', 'FALLIDO', 'DEVUELTO'];
const STATUS_LABEL: Record<string, string> = {
  CREADO: 'Creado', RECOGIDO: 'Recogido', EN_TRANSITO: 'En tránsito',
  EN_CENTRO_DESTINO: 'En centro destino', SALIDA_ENTREGA: 'En reparto',
  ENTREGADO: 'Entregado', FALLIDO: 'Fallido', DEVUELTO: 'Devuelto',
};
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  CREADO: ['RECOGIDO', 'EN_TRANSITO', 'FALLIDO', 'DEVUELTO'],
  RECOGIDO: ['EN_TRANSITO', 'EN_CENTRO_DESTINO', 'SALIDA_ENTREGA', 'ENTREGADO', 'FALLIDO', 'DEVUELTO'],
  EN_TRANSITO: ['EN_CENTRO_DESTINO', 'SALIDA_ENTREGA', 'ENTREGADO', 'FALLIDO', 'DEVUELTO'],
  EN_CENTRO_DESTINO: ['EN_TRANSITO', 'SALIDA_ENTREGA', 'ENTREGADO', 'FALLIDO', 'DEVUELTO'],
  SALIDA_ENTREGA: ['EN_TRANSITO', 'ENTREGADO', 'FALLIDO', 'DEVUELTO'],
  FALLIDO: ['EN_TRANSITO', 'ENTREGADO', 'DEVUELTO'],
  ENTREGADO: [],
  DEVUELTO: [],
};

interface Shipment {
  id: string;
  guia: string;
  transportadora: string;
  estado: string;
  creado_en: string;
  actualizado_en: string;
  entregado_en: string | null;
  url_rastreo: string | null;
  origen_ciudad: string | null;
  origen_departamento: string | null;
  destino_ciudad: string | null;
  destino_departamento: string | null;
  pedido_id: string;
  total: string | number;
  nombre_entrega: string;
  prestador_comisionado_id: number | null;
  proveedor_nombre: string | null;
  proveedor_email: string | null;
}

export default function AdminLogisticsPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceAvailable, setSourceAvailable] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [problematicOnly, setProblematicOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [selected, setSelected] = useState<Shipment | null>(null);
  const [newStatus, setNewStatus] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setSourceAvailable(false);
    try {
      const query = new URLSearchParams({ page: String(page), limit: '30' });
      if (statusFilter) query.set('estado', statusFilter);
      if (problematicOnly) query.set('solo_problematicos', 'true');
      const response = await fetch(`/api/admin/logistics/shipments?${query}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudieron cargar los envíos.');
      if (body.success !== true || !Array.isArray(body.data)) throw new Error('La respuesta de logística no tiene el formato esperado.');
      setShipments(body.data);
      setPages(Math.max(1, Number(body.pagination?.pages) || 1));
      setSourceAvailable(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Error al consultar logística.');
      setShipments([]);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, problematicOnly]);

  useEffect(() => { void load(); }, [load]);

  const updateStatus = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/admin/logistics/shipments/${selected.id}/manual-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ estado: newStatus, nota: note }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo actualizar el envío.');
      setSelected(null);
      setNote('');
      setNotice(`Envío ${selected.guia}: estado actualizado a ${STATUS_LABEL[newStatus] || newStatus}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Error al actualizar el envío.');
    } finally {
      setSaving(false);
    }
  };

  const money = (value: string | number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const date = (value: string | null) => value ? new Date(value).toLocaleString('es-CO') : '—';

  return (
    <main className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Logística GlowStore</h1>
          <p className="mt-1 text-gray-500">Seguimiento de guías y gestión de incidencias por envío.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="btn btn-secondary flex items-center gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </header>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-green-800">{notice}</div>}

      <section className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <label className="min-w-52 flex-1 text-sm font-medium text-gray-700">Estado
          <select className="input mt-1 w-full" value={statusFilter} onChange={(event) => { setPage(1); setStatusFilter(event.target.value); }}>
            <option value="">Todos los estados</option>
            {STATUS.map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
          <input type="checkbox" checked={problematicOnly} onChange={(event) => { setPage(1); setProblematicOnly(event.target.checked); }} />
          Incidencias y envíos en tránsito
        </label>
      </section>

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {loading ? <div className="p-10 text-center text-gray-500">Cargando envíos…</div> : !sourceAvailable ? (
          <div className="p-10 text-center text-red-700"><AlertTriangle className="mx-auto mb-3 h-9 w-9" />No fue posible consultar los envíos. No podemos confirmar que la bandeja esté vacía.</div>
        ) : shipments.length === 0 ? (
          <div className="p-10 text-center text-gray-500"><Truck className="mx-auto mb-3 h-9 w-9 text-gray-300" />No hay envíos para los filtros seleccionados.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr>
                <th className="px-4 py-3">Pedido / guía</th><th className="px-4 py-3">Proveedor</th><th className="px-4 py-3">Ruta / cliente</th><th className="px-4 py-3">Transportadora</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Actualizado</th><th className="px-4 py-3">Gestión</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">{shipments.map((shipment) => (
                <tr key={shipment.id} className="align-top hover:bg-gray-50">
                  <td className="px-4 py-3"><div className="font-mono">#{shipment.pedido_id.slice(0, 8).toUpperCase()}</div><div className="text-xs text-gray-500">Guía: {shipment.guia || 'pendiente'}</div>{shipment.guia?.startsWith('MOCK-') && <div className="text-xs font-semibold text-amber-700">SIMULADO — no válido ante transportadora</div>}<div className="text-xs text-gray-500">Total del pedido: {money(shipment.total)}</div></td>
                  <td className="px-4 py-3">{shipment.proveedor_nombre || 'Sin proveedor'}<div className="text-xs text-gray-500">{shipment.proveedor_email || ''}</div></td>
                  <td className="px-4 py-3">{shipment.nombre_entrega}<div className="text-xs text-gray-500">{shipment.origen_ciudad || 'Origen pendiente'} → {shipment.destino_ciudad || 'Destino pendiente'}</div></td>
                  <td className="px-4 py-3">{shipment.transportadora || 'Por asignar'}{!shipment.guia?.startsWith('MOCK-') && shipment.url_rastreo && <a className="ml-2 inline-flex text-blue-700" href={shipment.url_rastreo} target="_blank" rel="noreferrer" aria-label="Abrir rastreo"><ExternalLink className="h-4 w-4" /></a>}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium">{STATUS_LABEL[shipment.estado] || shipment.estado}</span></td>
                  <td className="px-4 py-3 text-gray-600">{date(shipment.actualizado_en)}</td>
                  <td className="px-4 py-3"><button className="btn btn-tertiary" onClick={() => { setSelected(shipment); setNewStatus(shipment.estado); setNote(''); }}>Registrar novedad</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
          <span>Página {page} de {pages}</span><div className="flex gap-2">
            <button className="btn btn-tertiary" disabled={page <= 1 || loading} onClick={() => setPage((n) => Math.max(1, n - 1))}>Anterior</button>
            <button className="btn btn-tertiary" disabled={page >= pages || loading} onClick={() => setPage((n) => Math.min(pages, n + 1))}>Siguiente</button>
          </div>
        </div>
      </section>

      {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
        <form onSubmit={updateStatus} className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="shipment-title">
          <div className="flex items-start justify-between"><div><h2 id="shipment-title" className="text-lg font-bold">Actualizar envío</h2><p className="text-sm text-gray-500">Guía {selected.guia} · pedido #{selected.pedido_id.slice(0, 8).toUpperCase()}</p></div><AlertTriangle className="h-5 w-5 text-amber-600" /></div>
          <label className="block text-sm font-medium">Nuevo estado<select className="input mt-1 w-full" value={newStatus} onChange={(event) => setNewStatus(event.target.value)}>{(ALLOWED_TRANSITIONS[selected.estado] || []).map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}</select></label>
          <label className="block text-sm font-medium">Nota de auditoría<textarea className="input mt-1 w-full" rows={3} minLength={5} required value={note} onChange={(event) => setNote(event.target.value)} placeholder="Describa la novedad (mínimo 5 caracteres)" /></label>
          <p className="text-xs text-gray-500">El cambio queda registrado en el envío. Al completar todos los paquetes, el pedido pasa a entregado.</p>
          <div className="flex justify-end gap-2"><button type="button" className="btn btn-tertiary" onClick={() => setSelected(null)}>Cancelar</button><button className="btn btn-primary flex items-center gap-2" disabled={saving || note.trim().length < 5 || !(ALLOWED_TRANSITIONS[selected.estado] || []).includes(newStatus)}><CheckCircle2 className="h-4 w-4" />{saving ? 'Guardando…' : 'Guardar estado'}</button></div>
        </form>
      </div>}
    </main>
  );
}
