'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { sanitizePath, sanitizeText } from '@/lib/security';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { 
  ShieldCheck, 
  FileText, 
  CheckCircle, 
  Clock, 
  Award, 
  FileDown, 
  PenTool, 
  RefreshCw 
} from 'lucide-react';

interface EvidenceItem {
  id: string;
  task_id: string;
  task_title?: string;
  business_name?: string;
  provider_id?: string;
  file_path: string;
  evidence_type: string;
  validation_state: string;
  reviewer_notes?: string;
  created_at: string;
}

interface TemplateItem {
  id: string;
  code: string;
  title: string;
  category: string;
  template_body: string;
  disclaimer: string;
}

interface GeneratedDocument {
  watermark: string;
  title: string;
  renderedBody: string;
  disclaimer: string;
}

type SourceStatus = 'loading' | 'available' | 'unavailable';

export default function AdminBusinessPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'queue' | 'templates' | 'kpis'>('queue');
  const [queue, setQueue] = useState<EvidenceItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [queueStatus, setQueueStatus] = useState<SourceStatus>('loading');
  const [templatesStatus, setTemplatesStatus] = useState<SourceStatus>('loading');
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('TPL_LABOR_CONTRACT_BEAUTY');
  const [generatedDoc, setGeneratedDoc] = useState<GeneratedDocument | null>(null);
  const [notes, setNotes] = useState<string>('');
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Helper para headers con CSRF token via BFF proxy
  const getBffHeaders = (contentType = 'application/json') => ({
    'X-Requested-With': 'XMLHttpRequest',
    ...(contentType ? { 'Content-Type': contentType } : {}),
  });

  // RBAC Direct URL Protection
  useEffect(() => {
    if (!loading && (!user || user.rol !== 'ADMIN')) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // Fetch real data from backend APIs via BFF proxy
  const fetchData = useCallback(async () => {
    setLoading(true);
    setQueueStatus('loading');
    setTemplatesStatus('loading');
    const headers = getBffHeaders();

    const [queueResult, templatesResult] = await Promise.allSettled([
      fetch('/api/v1/business/admin/queue', { headers }),
      fetch('/api/v1/business/templates', { headers }),
    ]);

    if (queueResult.status === 'fulfilled') {
      try {
        const response = queueResult.value;
        const payload = await response.json();
        if (!response.ok || payload?.success !== true || !Array.isArray(payload.data)) {
          throw new Error('Respuesta no disponible o inválida para la cola de evidencias.');
        }
        setQueue(payload.data);
        setQueueStatus('available');
      } catch (err) {
        console.warn('No se pudo cargar la cola de evidencias:', err);
        setQueueStatus('unavailable');
      }
    } else {
      console.warn('No se pudo conectar con la cola de evidencias:', queueResult.reason);
      setQueueStatus('unavailable');
    }

    if (templatesResult.status === 'fulfilled') {
      try {
        const response = templatesResult.value;
        const payload = await response.json();
        if (!response.ok || payload?.success !== true || !Array.isArray(payload.data)) {
          throw new Error('Respuesta no disponible o inválida para las plantillas.');
        }
        setTemplates(payload.data);
        setTemplatesStatus('available');
      } catch (err) {
        console.warn('No se pudieron cargar las plantillas:', err);
        setTemplatesStatus('unavailable');
      }
    } else {
      console.warn('No se pudo conectar con las plantillas:', templatesResult.reason);
      setTemplatesStatus('unavailable');
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Approve / Reject Evidence
  const handleReview = async (evidenceId: string, action: 'APPROVED' | 'REJECTED') => {
    setActionLoading(evidenceId);
    try {
      const headers = getBffHeaders();
      const res = await fetch(`/api/v1/business/admin/evidence/${evidenceId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          action,
          notes: notes || (action === 'APPROVED' ? 'Aprobado por administración.' : 'Rechazado por inconsistencias.')
        })
      });

      if (res.ok) {
        setFeedbackMsg(`Evidencia ${action === 'APPROVED' ? 'aprobada' : 'rechazada'} exitosamente.`);
        setNotes('');
        await fetchData();
      } else {
        setFeedbackMsg('Error procesando revisión de evidencia.');
      }
    } catch {
      setFeedbackMsg('Fallo de conexión al enviar revisión.');
    } finally {
      setActionLoading(null);
    }
  };

  // Generate Document Draft
  const handleGenerateDocument = async () => {
    setLoading(true);
    try {
      const headers = getBffHeaders();
      const res = await fetch('/api/v1/business/documents/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          template_code: selectedTemplate,
          variables: {
            employer_name: 'Establecimiento Ejemplo SAS',
            employee_name: 'Colaborador Ejemplo',
            job_title: 'Estilista Profesional',
            salary: '$ 2.200.000 COP',
            business_name: 'Salón Éxito Demo',
            city: 'Bogotá'
          }
        })
      });

      if (res.ok) {
        const result = await res.json();
        if (result.success) {
          setGeneratedDoc(result.data);
        }
      }
    } catch (err) {
      console.warn('Error generando documento:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f7f5f0] text-[#2b2420] p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#e8e1d7] pb-6">
        <div>
          <div className="flex items-center gap-3">
            <ShieldCheck className="text-rose-500 w-8 h-8" />
            <h1 className="text-3xl font-bold text-[#2b2420] tracking-tight">GlowApp Business Admin</h1>
          </div>
          <p className="text-[#71685f] text-sm mt-1">
            Gestión de cumplimiento regulatorio, verificación de evidencias y generación de borradores documentales.
          </p>
        </div>

        <button 
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 bg-[#f2eee8] hover:bg-[#e8e1d7] rounded-xl text-[#403a35] text-sm font-medium transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualizar Datos
        </button>
      </div>

      {feedbackMsg && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-800 px-4 py-3 rounded-xl flex justify-between items-center text-sm">
          <span>{feedbackMsg}</span>
          <button onClick={() => setFeedbackMsg(null)} className="font-bold text-rose-400 hover:text-[#2b2420]">✕</button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white border border-[#e8e1d7] p-6 rounded-2xl">
          <div className="flex justify-between items-start">
            <span className="text-[#71685f] text-xs font-semibold uppercase tracking-wider">Pendientes de Revisión</span>
            <Clock className="w-5 h-5 text-amber-400" />
          </div>
          <p className="text-3xl font-extrabold text-[#2b2420] mt-4">{queueStatus === 'available' ? queue.length : '—'}</p>
          <p className="text-xs text-[#8a8178] mt-1">{queueStatus === 'available' ? 'Evidencias en cola' : 'Fuente no disponible'}</p>
        </div>

        <div className="bg-white border border-[#e8e1d7] p-6 rounded-2xl">
          <div className="flex justify-between items-start">
            <span className="text-[#71685f] text-xs font-semibold uppercase tracking-wider">Cumplimiento Medio</span>
            <Award className="w-5 h-5 text-emerald-400" />
          </div>
          <p className="text-3xl font-extrabold text-[#2b2420] mt-4">—</p>
          <p className="text-xs text-[#8a8178] mt-1">Métrica sin fuente conectada</p>
        </div>

        <div className="bg-white border border-[#e8e1d7] p-6 rounded-2xl">
          <div className="flex justify-between items-start">
            <span className="text-[#71685f] text-xs font-semibold uppercase tracking-wider">Plantillas Activas</span>
            <FileText className="w-5 h-5 text-sky-400" />
          </div>
          <p className="text-3xl font-extrabold text-[#2b2420] mt-4">{templatesStatus === 'available' ? templates.length : '—'}</p>
          <p className="text-xs text-[#8a8178] mt-1">{templatesStatus === 'available' ? 'Plantillas informadas por el backend' : 'Fuente no disponible'}</p>
        </div>

        <div className="bg-white border border-[#e8e1d7] p-6 rounded-2xl">
          <div className="flex justify-between items-start">
            <span className="text-[#71685f] text-xs font-semibold uppercase tracking-wider">Estado del Servidor</span>
            <ShieldCheck className="w-5 h-5 text-rose-500" />
          </div>
          <p className="text-lg font-bold text-[#403a35] mt-4">No consultado</p>
          <p className="text-xs text-[#8a8178] mt-1">Salud del servidor sin fuente conectada</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#e8e1d7] space-x-8">
        <button
          onClick={() => setActiveTab('queue')}
          className={`pb-4 font-semibold text-sm transition-all border-b-2 ${
            activeTab === 'queue'
              ? 'border-rose-500 text-rose-400'
              : 'border-transparent text-[#71685f] hover:text-[#403a35]'
          }`}
        >
          Cola de Verificación ({queueStatus === 'available' ? queue.length : '—'})
        </button>

        <button
          onClick={() => setActiveTab('templates')}
          className={`pb-4 font-semibold text-sm transition-all border-b-2 ${
            activeTab === 'templates'
              ? 'border-rose-500 text-rose-400'
              : 'border-transparent text-[#71685f] hover:text-[#403a35]'
          }`}
        >
          Documentos & Plantillas
        </button>
      </div>

      {/* Tab 1: Queue */}
      {activeTab === 'queue' && (
        <div className="space-y-6">
          <div className="bg-white border border-[#e8e1d7] rounded-2xl p-6">
            <h2 className="text-lg font-bold text-[#2b2420] mb-4">Evidencias Subidas Pendientes de Validación</h2>

            {queueStatus === 'loading' ? (
              <div className="text-center py-12 text-[#8a8178]">Consultando la fuente de evidencias…</div>
            ) : queueStatus === 'unavailable' ? (
              <div className="text-center py-12 text-amber-700">La fuente de evidencias no está disponible; el panel no puede confirmar que la cola esté vacía.</div>
            ) : queue.length === 0 ? (
              <div className="text-center py-12 text-[#8a8178]">
                <CheckCircle className="w-12 h-12 mx-auto text-[#a0978e] mb-3" />
                <p>No hay evidencias pendientes en la cola de revisión.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-[#403a35]">
                  <thead className="bg-[#f7f5f0] text-[#71685f] uppercase text-xs">
                    <tr>
                      <th className="p-4 rounded-l-xl">Establecimiento / Tarea</th>
                      <th className="p-4">Tipo Evidencia</th>
                      <th className="p-4">Estado Actual</th>
                      <th className="p-4">Archivo / Notas</th>
                      <th className="p-4 text-right rounded-r-xl">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e8e1d7]">
                    {queue.map(item => (
                      <tr key={item.id} className="hover:bg-[#f7f5f0]">
                        <td className="p-4">
                          <p className="font-semibold text-[#2b2420]">{item.business_name || 'Salón de Belleza'}</p>
                          <p className="text-xs text-[#71685f]">{item.task_title || item.task_id}</p>
                        </td>
                        <td className="p-4">
                          <span className="bg-[#f2eee8] text-[#403a35] text-xs px-2.5 py-1 rounded-lg border border-[#ded6cb]">
                            {item.evidence_type}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className="bg-amber-500/10 text-amber-400 text-xs px-2.5 py-1 rounded-lg border border-amber-500/20">
                            {item.validation_state}
                          </span>
                        </td>
                        <td className="p-4">
                          <p className="text-xs font-mono text-[#71685f] truncate max-w-xs">{sanitizePath(item.file_path)}</p>
                          <p className="text-xs text-[#8a8178] italic mt-0.5">{sanitizeText(item.reviewer_notes)}</p>
                        </td>
                        <td className="p-4 text-right space-x-2">
                          <button
                            onClick={() => handleReview(item.id, 'APPROVED')}
                            disabled={actionLoading === item.id}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-1.5 rounded-lg transition-all"
                          >
                            Aprobar
                          </button>
                          <button
                            onClick={() => handleReview(item.id, 'REJECTED')}
                            disabled={actionLoading === item.id}
                            className="bg-rose-600 hover:bg-rose-500 text-white text-xs px-3 py-1.5 rounded-lg transition-all"
                          >
                            Rechazar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Templates & Document Generator */}
      {activeTab === 'templates' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Template Selection */}
          <div className="bg-white border border-[#e8e1d7] rounded-2xl p-6 space-y-6">
            <h2 className="text-lg font-bold text-[#2b2420]">Generador de Borradores Documentales</h2>
            
            <div>
              <label className="block text-xs font-semibold uppercase text-[#71685f] mb-2">Seleccionar Plantilla</label>
              <select
                value={selectedTemplate}
                onChange={e => setSelectedTemplate(e.target.value)}
                className="w-full bg-[#f7f5f0] border border-[#e8e1d7] rounded-xl p-3 text-sm text-[#2b2420] focus:outline-none focus:border-rose-500"
              >
                {templates.map(t => (
                  <option key={t.code} value={t.code}>{t.title} ({t.category})</option>
                ))}
              </select>
            </div>

            <button
              onClick={handleGenerateDocument}
              disabled={loading}
              className="w-full bg-rose-600 hover:bg-rose-500 text-white font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
            >
              <PenTool className="w-4 h-4" />
              Generar Documento con Marca de Agua
            </button>
          </div>

          {/* Generated Document Preview */}
          <div className="bg-white border border-[#e8e1d7] rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-[#2b2420] flex items-center gap-2">
              <FileDown className="w-5 h-5 text-rose-500" />
              Vista Previa del Documento
            </h2>

            {generatedDoc ? (
              <div className="bg-[#f7f5f0] border border-[#e8e1d7] p-6 rounded-xl space-y-4 text-xs">
                <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 p-2.5 rounded-lg font-bold text-center uppercase tracking-wide">
                  {generatedDoc.watermark}
                </div>

                <h3 className="font-bold text-sm text-[#2b2420]">{generatedDoc.title}</h3>

                <div className="bg-white p-4 rounded-lg font-mono text-[#403a35] whitespace-pre-wrap max-h-64 overflow-y-auto border border-[#e8e1d7]">
                  {generatedDoc.renderedBody}
                </div>

                <div className="bg-[#fbfaf8] p-3 rounded-lg border border-[#e8e1d7] text-[#71685f] italic">
                  {generatedDoc.disclaimer}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-[#8a8178] border border-dashed border-[#e8e1d7] rounded-xl">
                <FileText className="w-10 h-10 mx-auto text-[#a0978e] mb-2" />
              <p>Selecciona una plantilla y presiona Generar documento para visualizar la vista previa.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
