'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
  User,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface ProviderVerification {
  id: number;
  nombre: string;
  email: string;
  business_name?: string | null;
  description?: string | null;
  documento_id_url?: string | null;
  rut_url?: string | null;
  certificacion_url?: string | null;
  estatus_verificacion?: string | null;
}

interface ReviewDocument {
  key: 'documento_id_url' | 'rut_url' | 'certificacion_url';
  label: string;
  help: string;
  url: string | null;
  requiredForApproval: boolean;
}

type PreviewKind = 'image' | 'pdf' | 'link';

interface DocumentPreview {
  label: string;
  url: string;
  kind: PreviewKind;
}

function getDocumentKind(url: string): PreviewKind {
  if (/^data:application\/pdf/i.test(url) || /\.pdf(?:$|[?#])/i.test(url)) return 'pdf';
  if (/^data:image\//i.test(url) || /\.(png|jpe?g|webp|gif)(?:$|[?#])/i.test(url)) return 'image';
  return 'link';
}

function hasDocument(value?: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function messageFromError(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message) return value.message;
  return fallback;
}

export default function ProviderValidationPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderVerification | null>(null);
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  useEffect(() => {
    if (user && user.rol !== 'ADMIN') router.push('/login');
  }, [user, router]);

  const fetchQueue = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch('/api/glow-admin/provider/pending', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || `No se pudo cargar la cola (HTTP ${response.status}).`);
      }
      if (payload?.success !== true || !Array.isArray(payload.data)) {
        throw new Error('La API devolvió una respuesta inválida para la cola de validación.');
      }
      setProviders(payload.data);
      setError(null);
    } catch (err) {
      setError(messageFromError(err, 'No se pudo conectar con la cola de validación.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchQueue();
    const timer = window.setInterval(() => void fetchQueue(true), 30000);
    return () => window.clearInterval(timer);
  }, [fetchQueue]);

  const providerDocuments = useMemo<ReviewDocument[]>(() => {
    if (!selectedProvider) return [];
    return [
      {
        key: 'documento_id_url',
        label: 'Documento de identidad',
        help: 'Obligatorio para aprobar la verificación.',
        url: selectedProvider.documento_id_url || null,
        requiredForApproval: true,
      },
      {
        key: 'certificacion_url',
        label: 'Acreditación profesional',
        help: 'Obligatoria para aprobar la verificación.',
        url: selectedProvider.certificacion_url || null,
        requiredForApproval: true,
      },
      {
        key: 'rut_url',
        label: 'RUT',
        help: 'Referencia únicamente. Su aprobación se hace en RUT e IVA.',
        url: selectedProvider.rut_url || null,
        requiredForApproval: false,
      },
    ];
  }, [selectedProvider]);

  const documentosObligatoriosCompletos = Boolean(
    selectedProvider &&
      hasDocument(selectedProvider.documento_id_url) &&
      hasDocument(selectedProvider.certificacion_url),
  );

  const ejecutarDecision = async (provider: ProviderVerification, decision: 'approve' | 'reject') => {
    if (decision === 'approve' && !documentosObligatoriosCompletos) return;
    const actionLabel = decision === 'approve' ? 'aprobar' : 'rechazar';
    if (!window.confirm(`¿Confirmas ${actionLabel} la verificación de identidad y acreditación de ${provider.nombre}?`)) return;

    setActionLoading(provider.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/glow-admin/provider/${decision}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ providerId: provider.id }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.success !== true) {
        throw new Error(payload?.error || `No se pudo ${actionLabel} al proveedor.`);
      }

      setNotice(decision === 'approve'
        ? `${provider.nombre} quedó aprobado. La app del proveedor recibirá el nuevo estado al actualizar.`
        : `La verificación de ${provider.nombre} quedó rechazada.`);
      setSelectedProvider(null);
      setPreview(null);
      await fetchQueue(true);
    } catch (err) {
      setError(messageFromError(err, `No se pudo ${actionLabel} al proveedor.`));
    } finally {
      setActionLoading(null);
    }
  };

  const abrirDocumento = (document: ReviewDocument) => {
    if (!hasDocument(document.url)) return;
    const kind = getDocumentKind(document.url);
    setPreview({ label: document.label, url: document.url, kind });
  };

  const totalDocumentosObligatoriosCompletos = providers.filter(
    (provider) => hasDocument(provider.documento_id_url) && hasDocument(provider.certificacion_url),
  ).length;

  return (
    <main className="min-h-screen space-y-6 bg-[#f7f5f0] p-4 text-[#27231d] md:p-8">
      <header className="flex flex-col justify-between gap-4 border-b border-[#e5dfd3] pb-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-emerald-700" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Validación de proveedores</h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#71685f]">
            Revisa los documentos de identidad y acreditación profesional. La revisión fiscal del RUT se administra por separado.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchQueue()}
          disabled={loading || refreshing}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#d9cfbd] bg-white px-4 py-2 text-sm font-semibold text-[#514b42] hover:bg-[#f1eee7] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading || refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Actualizar cola
        </button>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Resumen de la cola">
        <div className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-[#71685f]">Pendientes de identidad/acreditación</p>
          <p className="mt-2 text-3xl font-bold text-amber-700">{loading ? '—' : providers.length}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-[#71685f]">Con documentos obligatorios cargados</p>
          <p className="mt-2 text-3xl font-bold text-emerald-700">{loading ? '—' : totalDocumentosObligatoriosCompletos}</p>
        </div>
        <div className="rounded-2xl border border-[#e5dfd3] bg-white p-5 shadow-sm sm:col-span-2 xl:col-span-1">
          <p className="text-sm text-[#71685f]">Aprobación de RUT</p>
          <a href="/admin/prestadores" className="mt-2 inline-flex items-center gap-2 font-semibold text-[#8b6b28] underline-offset-4 hover:underline">
            Ir a RUT e IVA <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </section>

      {notice && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{notice}</p>
          <button type="button" className="ml-auto rounded p-1 hover:bg-emerald-100" aria-label="Cerrar aviso" onClick={() => setNotice(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{error}</p>
          <button type="button" className="ml-auto rounded p-1 hover:bg-rose-100" aria-label="Cerrar error" onClick={() => setError(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-[#e5dfd3] bg-white shadow-sm" aria-labelledby="provider-queue-title">
        <div className="flex flex-col gap-2 border-b border-[#eee8de] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="provider-queue-title" className="text-lg font-semibold">Cola de verificación</h2>
            <p className="text-sm text-[#777064]">Fuente: GET /api/glow-admin/provider/pending</p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            {loading ? 'Cargando…' : `${providers.length} pendientes`}
          </span>
        </div>

        {loading ? (
          <div className="flex min-h-48 items-center justify-center gap-3 text-[#777064]">
            <Loader2 className="h-5 w-5 animate-spin" /> Cargando proveedores…
          </div>
        ) : providers.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            <h3 className="mt-3 font-semibold">No hay verificaciones pendientes</h3>
            <p className="mt-1 text-sm text-[#777064]">La cola está vacía. Se actualizará automáticamente cada 30 segundos.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#eee8de]">
            {providers.map((provider) => {
              const tieneIdentidad = hasDocument(provider.documento_id_url);
              const tieneAcreditacion = hasDocument(provider.certificacion_url);
              const completos = tieneIdentidad && tieneAcreditacion;
              return (
                <article key={provider.id} className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-start gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f5eee0] text-[#8b6b28]">
                      <User className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold">{provider.nombre}</h3>
                      <p className="truncate text-sm text-[#71685f]">{provider.email}</p>
                      {provider.business_name && <p className="mt-1 text-sm text-[#514b42]">{provider.business_name}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <DocumentStatus label="Identidad" present={tieneIdentidad} />
                        <DocumentStatus label="Acreditación" present={tieneAcreditacion} />
                        <DocumentStatus label="RUT" present={hasDocument(provider.rut_url)} neutral />
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 lg:shrink-0">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${completos ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
                      {completos ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                      {completos ? 'Documentos listos para revisar' : 'Faltan documentos obligatorios'}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setSelectedProvider(provider); setPreview(null); }}
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#d9cfbd] px-4 py-2 text-sm font-semibold text-[#514b42] hover:bg-[#f7f5f0]"
                    >
                      <Eye className="h-4 w-4" /> Revisar documentos
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selectedProvider && (
        <div className="provider-review-overlay fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 sm:p-5 lg:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelectedProvider(null); setPreview(null); } }}>
          <section role="dialog" aria-modal="true" aria-labelledby="review-provider-title" className="flex h-[min(92dvh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-[#eee8de] px-5 py-4 md:px-7">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#8b6b28]">Revisión de identidad y acreditación</p>
                <h2 id="review-provider-title" className="mt-1 truncate text-xl font-bold">{selectedProvider.nombre}</h2>
                <p className="mt-1 text-sm text-[#71685f]">{selectedProvider.email} · ID {selectedProvider.id}</p>
              </div>
              <button type="button" aria-label="Cerrar revisión" onClick={() => { setSelectedProvider(null); setPreview(null); }} className="rounded-lg p-2 text-[#71685f] hover:bg-[#f1eee7]"><X className="h-5 w-5" /></button>
            </header>

            <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-4 sm:p-5 md:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.2fr)] md:p-6">
              <div className="space-y-4 md:min-h-0 md:overflow-y-auto md:pr-1">
                {providerDocuments.map((document) => (
                  <article key={document.key} className="rounded-xl border border-[#e5dfd3] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{document.label}</h3>
                        <p className="mt-1 text-xs leading-5 text-[#777064]">{document.help}</p>
                      </div>
                      <DocumentStatus label={hasDocument(document.url) ? 'Cargado' : 'Falta'} present={hasDocument(document.url)} neutral={!document.requiredForApproval} />
                    </div>
                    {hasDocument(document.url) ? (
                      <button
                        type="button"
                        onClick={() => abrirDocumento(document)}
                        className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#d9cfbd] px-3 py-2 text-sm font-semibold text-[#514b42] hover:bg-[#f7f5f0]"
                      >
                        <Eye className="h-4 w-4" /> Ver documento
                      </button>
                    ) : (
                      <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">No hay archivo disponible para revisar.</p>
                    )}
                  </article>
                ))}
                {selectedProvider.description && (
                  <div className="rounded-xl bg-[#f7f5f0] p-4">
                    <h3 className="text-sm font-semibold">Descripción del proveedor</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#514b42]">{selectedProvider.description}</p>
                  </div>
                )}
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-5 text-sky-950">
                  Aprobar aquí cambia la verificación de identidad/acreditación. El RUT sigue su flujo independiente en <strong>Proveedores → RUT e IVA</strong>.
                </div>
              </div>

              <div className="flex min-h-[260px] flex-col overflow-hidden rounded-xl border border-[#e5dfd3] bg-[#f7f5f0] md:min-h-0">
                {preview ? (
                  <>
                    <div className="flex items-center justify-between gap-3 border-b border-[#e5dfd3] bg-white px-4 py-3">
                      <p className="truncate text-sm font-semibold">{preview.label}</p>
                      <a href={preview.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#8b6b28] hover:underline">
                        Abrir aparte <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                    <div className="flex min-h-[220px] flex-1 items-center justify-center overflow-auto p-3 md:min-h-0">
                      {preview.kind === 'image' ? (
                        <img src={preview.url} alt={preview.label} className="max-h-[55dvh] max-w-full rounded-lg object-contain" />
                      ) : preview.kind === 'pdf' ? (
                        <iframe title={preview.label} src={preview.url} className="h-[50dvh] min-h-[220px] w-full rounded-lg bg-white md:h-full" />
                      ) : (
                        <div className="max-w-sm p-6 text-center">
                          <FileText className="mx-auto h-10 w-10 text-[#8b6b28]" />
                          <p className="mt-3 font-semibold">Vista previa no disponible</p>
                          <p className="mt-1 text-sm text-[#71685f]">Abre el archivo en otra pestaña para revisarlo.</p>
                          <a href={preview.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#2b2420] px-4 py-2 text-sm font-semibold text-white hover:bg-black">
                            Abrir documento <ExternalLink className="h-4 w-4" />
                          </a>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-[#777064]">
                    <FileText className="h-10 w-10 text-[#b8aa91]" />
                    <p className="mt-3 font-medium">Selecciona un documento para verlo</p>
                    <p className="mt-1 text-sm">Revisa identidad y acreditación antes de aprobar.</p>
                  </div>
                )}
              </div>
            </div>

            <footer className="flex shrink-0 flex-col-reverse gap-3 border-t border-[#eee8de] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 md:px-7">
              <p className="text-xs text-[#777064]">La decisión se registra en el historial administrativo.</p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void ejecutarDecision(selectedProvider, 'reject')}
                  disabled={actionLoading === selectedProvider.id}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-50"
                >
                  {actionLoading === selectedProvider.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                  Rechazar
                </button>
                <button
                  type="button"
                  onClick={() => void ejecutarDecision(selectedProvider, 'approve')}
                  disabled={actionLoading === selectedProvider.id || !documentosObligatoriosCompletos}
                  title={!documentosObligatoriosCompletos ? 'Carga documento de identidad y acreditación para poder aprobar.' : undefined}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {actionLoading === selectedProvider.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Aprobar proveedor
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}

function DocumentStatus({ label, present, neutral = false }: { label: string; present: boolean; neutral?: boolean }) {
  const tone = !present
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : neutral
      ? 'border-slate-200 bg-slate-50 text-slate-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}>
      {present ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}
