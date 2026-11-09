'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  BookOpen, 
  Plus, 
  Edit, 
  Trash2, 
  Loader2, 
  AlertCircle,
  CheckCircle,
  Users,
  Layers,
  FileText,
  Award,
  ArrowUpDown,
  Search,
  Filter
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface Course {
  id: string;
  title: string;
  description: string;
  category: string;
  badge_name: string;
  created_at: string;
  modules_count: number;
  lessons_count: number;
  quizzes_count: number;
  certificates_issued: number;
  enrolled_providers: number;
}

export default function AcademiaAdminPage() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  // const [showOnlyActive, setShowOnlyActive] = useState(false); // unused

  // Helper para headers con CSRF token via BFF proxy
  const getBffHeaders = (contentType = 'application/json') => ({
    'X-Requested-With': 'XMLHttpRequest',
    ...(contentType ? { 'Content-Type': contentType } : {}),
  });

  const fetchCourses = async () => {
    try {
      setLoading(true);
      const headers = getBffHeaders();
      const response = await fetch('/api/admin/academy/courses', { headers });
      
      if (!response.ok) {
        throw new Error('Error al cargar cursos');
      }
      
      const data = await response.json();
      // El backend devuelve un array plano; si alguna vez devuelve otra cosa
      // (p. ej. {error}), degradamos a lista vacia en vez de romper el render.
      setCourses(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  const handleDelete = async (courseId: string) => {
    if (!window.confirm('¿Estás seguro de eliminar este curso? Esta acción no se puede deshacer.')) return;
    
    try {
      const headers = getBffHeaders();
      const response = await fetch(`/api/admin/academy/courses/${courseId}`, {
        method: 'DELETE',
        headers,
      });
      
      if (!response.ok) throw new Error('Error al eliminar');
      
      fetchCourses();
    } catch (err) {
      alert('Error al eliminar el curso');
    }
  };

  const filteredCourses = courses.filter(course => {
    const matchesSearch = course.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          course.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          course.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || course.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const categories = [...new Set(courses.map(c => c.category))];

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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Academia Glow - Administración</h1>
          <p className="text-gray-500 mt-1">Gestiona cursos, módulos, lecciones y exámenes de certificación</p>
        </div>
        <Link
          href="/admin/academia/nuevo"
          className="inline-flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-5 py-3 rounded-xl font-semibold transition-colors shadow-sm shadow-rose-500/20"
        >
          <Plus size={20} />
          <span>Nuevo Curso</span>
        </Link>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Total Cursos" 
          value={courses.length} 
          icon={BookOpen} 
          color="bg-rose-500" 
          bgColor="bg-rose-50" 
        />
        <StatCard 
          title="Prestadores Inscritos" 
          value={courses.reduce((sum, c) => sum + (c.enrolled_providers || 0), 0)} 
          icon={Users} 
          color="bg-blue-500" 
          bgColor="bg-blue-50" 
        />
        <StatCard 
          title="Certificados Emitidos" 
          value={courses.reduce((sum, c) => sum + (c.certificates_issued || 0), 0)} 
          icon={Award} 
          color="bg-amber-500" 
          bgColor="bg-amber-50" 
        />
        <StatCard 
          title="Total Lecciones" 
          value={courses.reduce((sum, c) => sum + (c.lessons_count || 0), 0)} 
          icon={FileText} 
          color="bg-emerald-500" 
          bgColor="bg-emerald-50" 
        />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Buscar por título, descripción, categoría..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
            />
          </div>
          <div className="flex gap-3">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none bg-white"
            >
              <option value="all">Todas las categorías</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Courses Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <Loader2 className="w-8 h-8 text-rose-500 animate-spin mx-auto mb-4" />
            <p className="text-gray-500">Cargando cursos...</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Error al cargar cursos</h3>
            <p className="text-gray-500 mb-4">{error}</p>
            <button
              onClick={fetchCourses}
              className="px-4 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors"
            >
              Reintentar
            </button>
          </div>
        ) : filteredCourses.length === 0 ? (
          <div className="p-12 text-center">
            <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No hay cursos</h3>
            <p className="text-gray-500 mb-6">
              {searchTerm || categoryFilter !== 'all' 
                ? 'No se encontraron cursos con esos filtros' 
                : 'Comienza creando tu primer curso de capacitación'}
            </p>
            {(!searchTerm && categoryFilter === 'all') && (
              <Link
                href="/admin/academia/nuevo"
                className="inline-flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-5 py-3 rounded-xl font-semibold transition-colors"
              >
                <Plus size={20} />
                <span>Crear Primer Curso</span>
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Curso</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Categoría</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Insignia</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Módulos</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Lecciones</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Exámenes</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Certificados</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Inscritos</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Fecha</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredCourses.map((course) => (
                  <tr key={course.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <Link
                        href={`/admin/academia/${course.id}`}
                        className="font-medium text-gray-900 hover:text-rose-600 transition-colors"
                      >
                        {course.title}
                      </Link>
                      <p className="text-sm text-gray-500 mt-1 line-clamp-1">{course.description}</p>
                    </td>
                    <td className="px-6 py-4 hidden md:table-cell">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700">
                        {course.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 hidden lg:table-cell">
                      <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                        <Award className="w-4 h-4 text-amber-500" />
                        {course.badge_name}
                      </span>
                    </td>
                    <td className="px-6 py-4 hidden lg:table-cell">
                      <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                        <Layers className="w-4 h-4" />
                        {course.modules_count}
                      </span>
                    </td>
                    <td className="px-6 py-4 hidden lg:table-cell">
                      <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                        <FileText className="w-4 h-4" />
                        {course.lessons_count}
                      </span>
                    </td>
                    <td className="px-6 py-4 hidden lg:table-cell">
                      <span className="text-sm text-gray-600">{course.quizzes_count}</span>
                    </td>
                    <td className="px-6 py-4 hidden md:table-cell">
                      <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                        <Award className="w-4 h-4 text-amber-500" />
                        {course.certificates_issued}
                      </span>
                    </td>
                    <td className="px-6 py-4 hidden md:table-cell">
                      <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                        <Users className="w-4 h-4" />
                        {course.enrolled_providers}
                      </span>
                    </td>
                    <td className="px-6 py-4 hidden md:table-cell text-sm text-gray-500">
                      {new Date(course.created_at).toLocaleDateString('es-ES', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                      })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/academia/${course.id}`}
                          className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                          title="Editar curso"
                        >
                          <Edit size={18} />
                        </Link>
                        <button
                          onClick={() => handleDelete(course.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title="Eliminar curso"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  bgColor: string;
}

function StatCard({ title, value, icon: Icon, color, bgColor }: StatCardProps) {
  return (
    <div className={`bg-white p-6 rounded-2xl shadow-sm border border-gray-200/80 flex items-center gap-4`}>
      <div className={`p-4 rounded-xl ${color} ${bgColor}`}>
        <Icon size={24} className="text-white" />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">{value.toLocaleString('es-CO')}</p>
      </div>
    </div>
  );
}