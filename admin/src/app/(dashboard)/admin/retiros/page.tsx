'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Building2, CheckCircle2, Clock3, Eye, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';

interface ReviewRow {
  provider_id: number;
  provider_name: string;
  email: string;
  banco: string;
  tipo_cuenta: string | null;
  numero_cuenta_enmascarado: string | null;
  titular_nombre: string | null;
  titular_documento_tipo: string | null;
  titular_documento_enmascarado: string | null;
  estado: string;
  solicitado_at: string | null;
  revision_estimada_at: string | null;
  revision_sla_horas: number;
  revision_vencida?: boolean;
  retiros_habilitables_despues_de: string | null;
  revision_token: string;
}

interface ReviewDetail extends ReviewRow {
  tipo_cuenta_bancaria: string | null;
  numero_cuenta: string;
  titular_documento_num: string | null;
}

interface ReviewEvidence {
  id: string;
  status: string;
  reason_code: string;
  requested_at: string;
  uploaded_at: string | null;
  file_mime_type?: string | null;
  file_base64?: string | null;
  file_bytes?: number | null;
}

const headers = { 'X-Requested-With': 'XMLHttpRequest' };

function fecha(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-CO');
}

export default function AdminCuentasRetiroPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<ReviewRow[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [reviewSlaHours, setReviewSlaHours] = useState(48);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Record<string, number | null> | null>(null);
  const [evidence, setEvidence] = useState<ReviewEvidence | null>(null);
  const [evidenceReason, setEvidenceReason] = useState('TITULAR_NO_COINCIDE');

  useEffect(() => {
    if (!authLoading && (!user || user.rol !== 'ADMIN')) router.replace('/login');
  }, [authLoading, user, router]);

  const loadQueue = useCallback(async (after: number | null = null, append = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/glow-admin/payout-account-reviews?limit=50&after_provider_id=${after || 0}`, { headers });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || `El backend respondió ${response.status}.`);
      setItems((current) => append ? [...current, ...(body.items || [])] : (body.items || []));
      setReviewSlaHours(Number(body.revision_sla_horas) || 48);
      setCursor(body.next_after_provider_id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la cola de revisión.');
      if (!append) setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  useEffect(() => {
    if (!detail) setEvidence(null);
  }, [detail]);

  useEffect(() => {
    void fetch('/api/glow-admin/payout-account-reviews/metrics?days=90', { headers })
      .then(async (response) => {
        const body = await response.json();
        if (response.ok && body.ok) setMetrics(body.metrics);
      }).catch(() => undefined);
  }, []);

  const openDetail = async (providerId: number) => {
    setLoadingDetail(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/glow-admin/payout-account-reviews/${providerId}`, { headers });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || `El backend respondió ${response.status}.`);
      setDetail(body.item);
      setReason('');
      setEvidence(null);
      const evidenceResponse = await fetch(`/api/glow-admin/payout-account-reviews/${providerId}/evidence`, { headers });
      if (evidenceResponse.ok) {
        const evidenceBody = await evidenceResponse.json();
        if (evidenceBody.ok) setEvidence(evidenceBody.evidence);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el detalle.');
    } finally {
      setLoadingDetail(false);
    }
  };

  const requestEvidence = async () => {
    if (!detail) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/glow-admin/payout-account-reviews/${detail.provider_id}/evidence-request`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason_code: evidenceReason }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || `El backend respondió ${response.status}.`);
      setNotice('Solicitud de soporte enviada al prestador. La revisión quedará pendiente hasta que lo cargue.');
      const refreshed = await fetch(`/api/glow-admin/payout-account-reviews/${detail.provider_id}/evidence`, { headers });
      if (refreshed.ok) { const evidenceBody = await refreshed.json(); setEvidence(evidenceBody.evidence || null); }
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo solicitar el soporte.'); }
    finally { setSaving(false); }
  };

  const cancelEvidenceRequest = async () => {
    if (!detail || !window.confirm('¿Cancelar la solicitud de soporte?')) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/glow-admin/payout-account-reviews/${detail.provider_id}/evidence-request/cancel`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || `El backend respondió ${response.status}.`);
      setEvidence(null);
      setNotice('Solicitud de soporte cancelada.');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo cancelar la solicitud.'); }
    finally { setSaving(false); }
  };

  const decide = async (decision: 'APROBAR' | 'RECHAZAR') => {
    if (!detail) return;
    if (decision === 'RECHAZAR' && reason.trim().length < 10) {
      setError('Escribe un motivo de rechazo de al menos 10 caracteres.');
      return;
    }
    const prompt = decision === 'APROBAR'
      ? `¿Confirmas aprobar la cuenta terminada en ${detail.numero_cuenta.slice(-4)}? El prestador podrá retirar cuando cumpla el periodo de protección y los demás requisitos.`
      : `¿Confirmas rechazar la cuenta de ${detail.provider_name}? Se notificará el motivo al prestador.`;
    if (!window.confirm(prompt)) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/glow-admin/payout-account-reviews/${detail.provider_id}/decision`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, motivo: reason.trim(), revision_token: detail.revision_token }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        if (response.status === 409) {
          setDetail(null);
          await loadQueue();
          throw new Error('La solicitud cambió durante la revisión. Actualicé la cola; abre de nuevo la solicitud.');
        }
        throw new Error(body.error || `El backend respondió ${response.status}.`);
      }
      setNotice(`Cuenta ${decision === 'APROBAR' ? 'aprobada' : 'rechazada'} para ${detail.provider_name}. Se notificó al prestador si el canal estaba disponible.`);
      setDetail(null);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la decisión.');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || !user || user.rol !== 'ADMIN') return null;

  return (
    <main className="min-h-screen space-y-6 bg-[#f7f5f0] p-4 text-[#2b2420] md:p-8">
      <header className="flex flex-col justify-between gap-4 border-b border-[#e8e1d7] pb-6 md:flex-row md:items-center">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3"><Building2 className="h-6 w-6 text-amber-700" /></div>
          <div>
            <h1 className="text-2xl font-bold text-[#2b2420] md:text-3xl">Cuentas de retiro</h1>
            <p className="mt-1 max-w-3xl text-sm text-[#71685f]">Revisa las cuentas bancarias que los prestadores agregaron o modificaron antes de habilitar retiros.</p>
          </div>
        </div>
        <button onClick={() => void loadQueue()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#ded6cb] bg-white px-4 py-2 text-sm font-medium hover:bg-[#f2eee8] disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar cola
        </button>
      </header>

      <div className="flex gap-3 rounded-xl border border-sky-400/20 bg-sky-400/5 p-4 text-sm text-sky-800">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
        <p>La revisión es administrativa. GlowApp no consulta al banco para confirmar titularidad automáticamente. Consulta los datos completos solo al abrir una solicitud; ese acceso queda auditado. Cada decisión debe corresponder a la documentación y procedimientos internos vigentes.</p>
      </div>

      <section aria-label="Indicadores del flujo de cuentas" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Inicios (90 días)', metrics?.starts],
          ['Envíos', metrics?.submitted],
          ['Abandonos', metrics?.abandoned],
          ['Rechazos / fallas', (metrics?.rejected || 0) + (metrics?.transfer_failures || 0)],
          ['Soportes solicitados', metrics?.support_opened],
          ['Revisión promedio (h)', metrics?.avg_review_hours],
        ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-[#e8e1d7] bg-white p-4"><p className="text-xs text-[#8a8178]">{label}</p><p className="mt-2 text-2xl font-semibold text-[#2b2420]">{value ?? '—'}</p><p className="mt-1 text-[11px] text-[#8a8178]">Medición desde la instrumentación de Fase 3</p></div>)}
      </section>

      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {notice && <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}

      {detail && (
        <section aria-labelledby="detail-title" className="space-y-5 rounded-2xl border border-amber-400/30 bg-white p-5 md:p-7">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <button onClick={() => setDetail(null)} className="mb-3 inline-flex items-center gap-2 text-sm text-[#71685f] hover:text-[#2b2420]"><ArrowLeft className="h-4 w-4" /> Volver a la cola</button>
              <h2 id="detail-title" className="text-xl font-bold text-[#2b2420]">Revisión de {detail.provider_name}</h2>
              <p className="text-sm text-[#71685f]">{detail.email} · Solicitud: {fecha(detail.solicitado_at)}</p>
            </div>
            <span className="inline-flex items-center gap-2 self-start rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-800"><Clock3 className="h-3.5 w-3.5" /> Pendiente</span>
          </div>

          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Entidad', detail.banco], ['Tipo de cuenta', detail.tipo_cuenta_bancaria || detail.tipo_cuenta],
              ['Número de cuenta', detail.numero_cuenta], ['Titular', detail.titular_nombre],
              ['Tipo de documento', detail.titular_documento_tipo], ['Documento', detail.titular_documento_num],
              [`Plazo objetivo (${detail.revision_sla_horas} h)`, fecha(detail.revision_estimada_at)],
              ['Protección de retiros hasta', fecha(detail.retiros_habilitables_despues_de)],
            ].map(([label, value]) => <div key={label} className="rounded-xl border border-[#e8e1d7] bg-[#f8f6f2] p-4"><dt className="text-xs font-semibold uppercase tracking-wide text-[#8a8178]">{label}</dt><dd className="mt-2 break-all text-sm text-[#2b2420]">{value || '—'}</dd></div>)}
          </dl>

          <section className="space-y-3 rounded-xl border border-[#e8e1d7] bg-[#f8f6f2] p-4" aria-label="Soporte de titularidad">
            <div><h3 className="font-semibold">Soporte excepcional</h3><p className="text-xs text-[#71685f]">Solicítalo solo ante una diferencia de titular, rechazo de transferencia o revisión de seguridad.</p></div>
            {evidence && <p className="text-sm">Estado: <strong>{evidence.status}</strong> · Solicitado: {fecha(evidence.requested_at)}</p>}
            {evidence?.status === 'REQUESTED' && <button onClick={() => void cancelEvidenceRequest()} disabled={saving} className="rounded-lg border border-[#ded6cb] px-3 py-2 text-sm disabled:opacity-40">Cancelar solicitud de soporte</button>}
            {evidence?.status === 'UPLOADED' && evidence.file_base64 && evidence.file_mime_type && <div className="space-y-2"><p className="text-xs text-[#71685f]">Imagen disponible solo para esta revisión. Se eliminará según el plazo de retención.</p><img alt="Soporte cargado por el prestador" className="max-h-80 rounded-lg border border-[#ded6cb] object-contain" src={`data:${evidence.file_mime_type};base64,${evidence.file_base64}`} /></div>}
            {!evidence || evidence.status === 'REVIEWED' || evidence.status === 'EXPIRED' || evidence.status === 'PURGED' ? <div className="flex flex-col gap-2 sm:flex-row"><select aria-label="Motivo de solicitud de soporte" value={evidenceReason} onChange={(event) => setEvidenceReason(event.target.value)} className="rounded-lg border border-[#ded6cb] bg-white px-3 py-2 text-sm"><option value="TITULAR_NO_COINCIDE">Diferencia en titular</option><option value="RECHAZO_TRANSFERENCIA">Rechazo de transferencia</option><option value="REVISION_RIESGO">Revisión de seguridad</option></select><button onClick={() => void requestEvidence()} disabled={saving} className="rounded-lg border border-amber-500/40 px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-40">Solicitar soporte</button></div> : null}
          </section>

          <label className="block text-sm font-medium text-[#403a35]" htmlFor="review-reason">Nota de revisión <span className="font-normal text-[#8a8178]">(opcional al aprobar, obligatoria al rechazar)</span></label>
          <textarea id="review-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={1000} className="w-full rounded-xl border border-[#ded6cb] bg-[#f7f5f0] p-3 text-sm text-[#2b2420] outline-none focus:border-amber-400" placeholder="Describe el criterio aplicado y, si corresponde, qué debe corregir el prestador." />
          <div className="flex flex-col-reverse justify-end gap-3 sm:flex-row">
            <button onClick={() => void decide('RECHAZAR')} disabled={saving || reason.trim().length < 10} className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-500/40 px-4 py-2.5 text-sm font-semibold text-rose-800 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"><XCircle className="h-4 w-4" />Rechazar y notificar</button>
            <button onClick={() => void decide('APROBAR')} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-[#2b2420] hover:bg-emerald-500 disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />Aprobar cuenta</button>
          </div>
        </section>
      )}

      <section aria-label="Solicitudes pendientes" className="overflow-hidden rounded-2xl border border-[#e8e1d7] bg-white">
        <div className="flex items-center justify-between border-b border-[#e8e1d7] px-5 py-4">
          <div><h2 className="font-semibold text-[#2b2420]">Solicitudes pendientes</h2><p className="mt-1 text-xs text-[#8a8178]">{items.length} solicitud{items.length === 1 ? '' : 'es'} cargada{items.length === 1 ? '' : 's'} · Objetivo: hasta {reviewSlaHours} horas calendario</p></div>
          <span className="rounded-lg bg-amber-400/10 px-3 py-1 text-sm font-semibold text-amber-800">{loading ? '…' : items.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-[#f8f6f2] text-xs uppercase tracking-wide text-[#8a8178]"><tr><th className="px-5 py-3">Prestador</th><th className="px-5 py-3">Entidad</th><th className="px-5 py-3">Cuenta</th><th className="px-5 py-3">Titular</th><th className="px-5 py-3">Solicitada</th><th className="px-5 py-3">Objetivo de revisión</th><th className="px-5 py-3">Acción</th></tr></thead>
            <tbody className="divide-y divide-[#e8e1d7]">
              {loading && items.length === 0 && <tr><td colSpan={7} className="px-5 py-12 text-center text-[#8a8178]">Cargando solicitudes…</td></tr>}
              {!loading && items.length === 0 && <tr><td colSpan={7} className="px-5 py-12 text-center text-[#8a8178]">No hay cuentas pendientes de revisión.</td></tr>}
              {items.map((item) => <tr key={item.provider_id} className="hover:bg-[#f7f5f0]">
                <td className="px-5 py-4"><div className="font-medium text-[#2b2420]">{item.provider_name || `Prestador ${item.provider_id}`}</div><div className="mt-1 text-xs text-[#8a8178]">{item.email}</div></td>
                <td className="px-5 py-4 text-[#403a35]">{item.banco || '—'}</td>
                <td className="px-5 py-4 font-mono text-[#403a35]">{item.numero_cuenta_enmascarado || '—'}</td>
                <td className="px-5 py-4"><div className="text-[#403a35]">{item.titular_nombre || '—'}</div><div className="mt-1 text-xs text-[#8a8178]">{item.titular_documento_tipo || ''} {item.titular_documento_enmascarado || ''}</div></td>
                <td className="px-5 py-4 whitespace-nowrap text-[#71685f]">{fecha(item.solicitado_at)}</td>
                <td className="px-5 py-4 whitespace-nowrap"><div className={item.revision_vencida ? 'text-rose-700' : 'text-[#403a35]'}>{fecha(item.revision_estimada_at)}</div><div className={`mt-1 text-xs ${item.revision_vencida ? 'font-semibold text-rose-700' : 'text-[#8a8178]'}`}>{item.revision_vencida ? 'Objetivo vencido' : `Hasta ${item.revision_sla_horas} h`}</div></td>
                <td className="px-5 py-4"><button onClick={() => void openDetail(item.provider_id)} disabled={loadingDetail} className="inline-flex items-center gap-2 rounded-lg border border-[#ded6cb] px-3 py-2 text-xs font-semibold text-[#403a35] hover:border-amber-400/50 hover:text-amber-800 disabled:opacity-50"><Eye className="h-4 w-4" />Revisar</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {cursor !== null && <div className="border-t border-[#e8e1d7] p-4 text-center"><button onClick={() => void loadQueue(cursor, true)} disabled={loading} className="rounded-lg border border-[#ded6cb] px-4 py-2 text-sm text-[#403a35] hover:bg-[#f2eee8] disabled:opacity-40">Cargar más</button></div>}
      </section>
    </main>
  );
}
