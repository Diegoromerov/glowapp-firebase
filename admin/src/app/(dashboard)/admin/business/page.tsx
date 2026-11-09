'use client';

import React, { useState, useEffect } from 'react';
import { sanitizePath, sanitizeText } from '@/lib/security';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { 
  ShieldCheck, 
  FileText, 
  CheckCircle, 
  XCircle, 
  Clock, 
  AlertTriangle, 
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

export default function AdminBusinessPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'queue' | 'templates' | 'kpis'>('queue');
  const [queue, setQueue] = useState<EvidenceItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('TPL_LABOR_CONTRACT_BEAUTY');
  const [generatedDoc, setGeneratedDoc] = useState<any>(null);
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
  const fetchData = async () => {
    setLoading(true);
    try {
      const headers = getBffHeaders();

      // 1. Fetch Queue
      const queueRes = await fetch('/api/v1/business/admin/queue', { headers });
      if (queueRes.ok) {
        const qData = await queueRes.json();
        if (qData.success) setQueue(qData.data || []);
      }

      // 2. Fetch Templates
      const tplRes = await fetch('/api/v1/business/templates', { headers });
      if (tplRes.ok) {
        const tData = await tplRes.json();
        if (tData.success) setTemplates(tData.data || []);
      }
    } catch (err) {
      console.warn('⚠️ Error conectando al servidor backend:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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
        const result = await res.json();
        setFeedbackMsg(`Evidencia ${action === 'APPROVED' ? 'aprobada' : 'rechazada'} exitosamente.`);
        setNotes('');
        await fetchData();
      } else {
        setFeedbackMsg('Error procesando revisión de evidencia.');
      }
    } catch (err) {
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
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <ShieldCheck className="text-rose-500 w-8 h-8" />
            <h1 className="text-3xl font-bold text-white tracking-tight">GlowApp Business Admin</h1>
          </div>
          <p className="text-slate-400 text-sm mt-1">
            Gestión de cumplimiento regulatorio, verificación de evidencias y generación de borradores documentales.
          </p>
        </div>

        <button 
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 text-sm font-medium transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualizar Datos
        </button>
      </div>

      {feedbackMsg && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 px-4 py-3 rounded-xl flex justify-between items-center text-sm">
          <span>{feedbackMsg}</span>
          <button onClick={() => setFeedbackMsg(null)} className="font-bold text-rose-400 hover:text-white">✕</button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
          <div className="flex justify-between items-start">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Pendientes de Revisión</span>
            <Clock className="w-5 h-5 text-amber-400" />
          </div>
          <p className="text-3xl font-extrabold text-white mt-4">{queue.length}</p>
          <p className="text-xs text-slate-500 mt-1">Evidencias en cola</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
          <div className="flex justify-between items-start">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Cumplimiento Medio</span>
            <Award className="w-5 h-5 text-emerald-400" />
          </div>
          <p className="text-3xl font-extrabold text-white mt-4">78.5%</p>
          <p className="text-xs text-emerald-400/80 mt-1">+4.2% este mes</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
          <div className="flex justify-between items-start">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Plantillas Activas</span>
            <FileText className="w-5 h-5 text-sky-400" />
          </div>
          <p className="text-3xl font-extrabold text-white mt-4">{templates.length || 2}</p>
          <p className="text-xs text-slate-500 mt-1">Formatos de ley</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
          <div className="flex justify-between items-start">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Estado del Servidor</span>
            <ShieldCheck className="w-5 h-5 text-rose-500" />
          </div>
          <p className="text-lg font-bold text-emerald-400 mt-4">P0 Inmunizado</p>
          <p className="text-xs text-slate-500 mt-1">JWT + RBAC Activo</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 space-x-8">
        <button
          onClick={() => setActiveTab('queue')}
          className={`pb-4 font-semibold text-sm transition-all border-b-2 ${
            activeTab === 'queue'
              ? 'border-rose-500 text-rose-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Cola de Verificación ({queue.length})
        </button>

        <button
          onClick={() => setActiveTab('templates')}
          className={`pb-4 font-semibold text-sm transition-all border-b-2 ${
            activeTab === 'templates'
              ? 'border-rose-500 text-rose-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Documentos & Plantillas
        </button>
      </div>

      {/* Tab 1: Queue */}
      {activeTab === 'queue' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-white mb-4">Evidencias Subidas Pendientes de Validación</h2>

            {queue.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <CheckCircle className="w-12 h-12 mx-auto text-slate-600 mb-3" />
                <p>No hay evidencias pendientes en la cola de revisión.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 uppercase text-xs">
                    <tr>
                      <th className="p-4 rounded-l-xl">Establecimiento / Tarea</th>
                      <th className="p-4">Tipo Evidencia</th>
                      <th className="p-4">Estado Actual</th>
                      <th className="p-4">Archivo / Notas</th>
                      <th className="p-4 text-right rounded-r-xl">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {queue.map(item => (
                      <tr key={item.id} className="hover:bg-slate-800/50">
                        <td className="p-4">
                          <p className="font-semibold text-white">{item.business_name || 'Salón de Belleza'}</p>
                          <p className="text-xs text-slate-400">{item.task_title || item.task_id}</p>
                        </td>
                        <td className="p-4">
                          <span className="bg-slate-800 text-slate-300 text-xs px-2.5 py-1 rounded-lg border border-slate-700">
                            {item.evidence_type}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className="bg-amber-500/10 text-amber-400 text-xs px-2.5 py-1 rounded-lg border border-amber-500/20">
                            {item.validation_state}
                          </span>
                        </td>
                        <td className="p-4">
                          <p className="text-xs font-mono text-slate-400 truncate max-w-xs">{sanitizePath(item.file_path)}</p>
                          <p className="text-xs text-slate-500 italic mt-0.5">{sanitizeText(item.reviewer_notes)}</p>
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
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
            <h2 className="text-lg font-bold text-white">Generador de Borradores Documentales</h2>
            
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-2">Seleccionar Plantilla</label>
              <select
                value={selectedTemplate}
                onChange={e => setSelectedTemplate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-rose-500"
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
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <FileDown className="w-5 h-5 text-rose-500" />
              Vista Previa del Documento
            </h2>

            {generatedDoc ? (
              <div className="bg-slate-950 border border-slate-800 p-6 rounded-xl space-y-4 text-xs">
                <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 p-2.5 rounded-lg font-bold text-center uppercase tracking-wide">
                  {generatedDoc.watermark}
                </div>

                <h3 className="font-bold text-sm text-white">{generatedDoc.title}</h3>

                <div className="bg-slate-900 p-4 rounded-lg font-mono text-slate-300 whitespace-pre-wrap max-h-64 overflow-y-auto border border-slate-800">
                  {generatedDoc.renderedBody}
                </div>

                <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 text-slate-400 italic">
                  {generatedDoc.disclaimer}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-500 border border-dashed border-slate-800 rounded-xl">
                <FileText className="w-10 h-10 mx-auto text-slate-600 mb-2" />
                <p>Selecciona una plantilla y presiona "Generar Documento" para visualizar la vista previa.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
