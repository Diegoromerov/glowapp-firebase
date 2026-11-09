'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, 
  Loader2, 
  Save, 
  X,
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function NuevoCursoPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: '',
    badge_name: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (error) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Validación
    if (!formData.title || !formData.description || !formData.category || !formData.badge_name) {
      setError('Todos los campos son obligatorios');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/admin/academy/courses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al crear el curso');
      }

      setSuccess(true);
      setTimeout(() => {
        router.push(`/admin/academia/${data.id}`);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    router.back();
  };

  if (user?.rol !== 'ADMIN') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900">Acceso denegado</h2>
          <p className="text-gray-500 mt-2">Solo los administradores pueden acceder a esta sección.</p>
        </div>
      </div>
    );
  }

  const categories = [
    'bioseguridad',
    'uñas',
    'maquillaje',
    'piel',
    'cabello',
    'cejas',
    'marketing',
    'negocios',
    'otro',
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleBack}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all"
        >
          <ArrowLeft size={24} />
        </button>
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Nuevo Curso</h1>
          <p className="text-gray-500 mt-1">Crea un nuevo curso de capacitación para prestadores</p>
        </div>
      </div>

      {success && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl text-green-800">
          <CheckCircle size={24} />
          <span className="font-medium">¡Curso creado exitosamente! Redirigiendo...</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-200/80 p-6 sm:p-8 space-y-6">
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-800">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label htmlFor="title" className="block text-sm font-semibold text-gray-700 mb-2">
            Título del Curso <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            id="title"
            name="title"
            value={formData.title}
            onChange={handleChange}
            placeholder="Ej: Protocolos de Bioseguridad y Calidad Glow"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
            required
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-semibold text-gray-700 mb-2">
            Descripción <span className="text-rose-500">*</span>
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows={4}
            placeholder="Describe el contenido, objetivos y qué aprenderán los prestadores..."
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all resize-y"
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label htmlFor="category" className="block text-sm font-semibold text-gray-700 mb-2">
              Categoría <span className="text-rose-500">*</span>
            </label>
            <select
              id="category"
              name="category"
              value={formData.category}
              onChange={handleChange}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all bg-white"
              required
            >
              <option value="">Seleccionar categoría</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="badge_name" className="block text-sm font-semibold text-gray-700 mb-2">
              Nombre de la Insignia <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              id="badge_name"
              name="badge_name"
              value={formData.badge_name}
              onChange={handleChange}
              placeholder="Ej: Profesional Certificada Glow"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
              required
            />
            <p className="mt-1 text-xs text-gray-500">Esta insignia se mostrará en el perfil del prestador al completar el curso</p>
          </div>
        </div>

        {/* Preview */}
        <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <CheckCircle className="text-emerald-500" size={20} />
            Vista Previa
          </h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Título:</span>
              <span className="font-medium text-gray-900">{formData.title || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Categoría:</span>
              <span className="font-medium text-gray-900">{formData.category ? formData.category.charAt(0).toUpperCase() + formData.category.slice(1) : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Insignia:</span>
              <span className="font-medium text-gray-900">{formData.badge_name || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Descripción:</span>
              <span className="font-medium text-gray-900 max-w-xs truncate">{formData.description || '—'}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row justify-end gap-4 pt-4 border-t border-gray-100">
          <button
            type="button"
            onClick={handleBack}
            className="px-6 py-3 text-gray-700 font-semibold border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-6 py-3 bg-rose-500 text-white font-semibold rounded-xl hover:bg-rose-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-rose-500/20"
          >
            {loading ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                <span>Guardando...</span>
              </>
            ) : (
              <>
                <Save size={20} />
                <span>Crear Curso</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}