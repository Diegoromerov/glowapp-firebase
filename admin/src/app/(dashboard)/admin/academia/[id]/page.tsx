// @ts-nocheck
'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, 
  Loader2, 
  Save, 
  Plus, 
  Edit, 
  Trash2, 
  X,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Layers,
  FileText,
  HelpCircle,
  Award,
  GripVertical,
  Eye,
  EyeOff,
  GraduationCap
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface Module {
  id: string;
  course_id: string;
  title: string;
  sort_order: number;
  lessons?: Lesson[];
}

interface Lesson {
  id: string;
  module_id: string;
  title: string;
  video_url: string | null;
  content_text: string | null;
  sort_order: number;
  module_title?: string;
  module_order?: number;
}

interface Quiz {
  id: string;
  course_id: string;
  question: string;
  options: string[];
  correct_index: number;
}

interface Course {
  id: string;
  title: string;
  description: string;
  category: string;
  badge_name: string;
  created_at: string;
}

interface ModuleFormData {
  title: string;
  sort_order: string;
}

interface LessonFormData {
  module_id: string;
  title: string;
  video_url: string;
  content_text: string;
  sort_order: string;
}

interface QuizFormData {
  question: string;
  options: string[];
  correct_index: number;
}

export default function EditarCursoPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const courseId = params.id as string;

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  // Métricas reales del curso que devuelve el backend (antes "Certificados" estaba
  // hardcodeado a 0 en la UI).
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // UI State
  const [activeTab, setActiveTab] = useState<'modules' | 'quizzes' | 'course'>('modules');
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [editingQuizId, setEditingQuizId] = useState<string | null>(null);
  const [showAddModule, setShowAddModule] = useState(false);
  const [showAddLesson, setShowAddLesson] = useState<string | null>(null);
  const [showAddQuiz, setShowAddQuiz] = useState(false);

  // Form states
  const [moduleForm, setModuleForm] = useState<ModuleFormData>({ title: '', sort_order: '' });
  const [lessonForm, setLessonForm] = useState<LessonFormData>({ module_id: '', title: '', video_url: '', content_text: '', sort_order: '' });
  const [quizForm, setQuizForm] = useState<QuizFormData>({ question: '', options: ['', '', '', ''], correct_index: 0 });

  const fetchCourseData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/admin/academy/courses/${courseId}`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        if (response.status === 404) throw new Error('Curso no encontrado');
        throw new Error('Error al cargar el curso');
      }
      
      const data = await response.json();
      setCourse(data.course);
      setModules(data.modules || []);
      setLessons(data.lessons || []);
      setQuizzes(data.quizzes || []);
      setStats(data.stats || null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourseData();
  }, [courseId]);

  // ==================== MODULE ACTIONS ====================
  const handleAddModule = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    
    try {
      const response = await fetch(`/api/admin/academy/courses/${courseId}/modules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: moduleForm.title,
          sort_order: moduleForm.sort_order ? parseInt(moduleForm.sort_order) : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Error al crear módulo');
      }

      const newModule = await response.json();
      setModules(prev => [...prev, newModule].sort((a, b) => a.sort_order - b.sort_order));
      setModuleForm({ title: '', sort_order: '' });
      setShowAddModule(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear módulo');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateModule = async (moduleId: string) => {
    const module = modules.find(m => m.id === moduleId);
    if (!module) return;

    try {
      const response = await fetch(`/api/admin/academy/modules/${moduleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: module.title,
          sort_order: module.sort_order,
        }),
      });

      if (!response.ok) throw new Error('Error al actualizar módulo');
      setEditingModuleId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar módulo');
    }
  };

  const handleDeleteModule = async (moduleId: string) => {
    if (!window.confirm('¿Eliminar este módulo? Se eliminarán todas sus lecciones.')) return;
    
    try {
      const response = await fetch(`/api/admin/academy/modules/${moduleId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Error al eliminar módulo');
      
      setModules(prev => prev.filter(m => m.id !== moduleId));
      setLessons(prev => prev.filter(l => l.module_id !== moduleId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar módulo');
    }
  };

  // Persiste el orden de los módulos: antes `moveModule` solo reordenaba el estado
  // de React y el orden se perdía al recargar (hallazgo T4 de la auditoría).
  const persistModuleOrder = async (ordered: Module[]) => {
    try {
      const response = await fetch(`/api/admin/academy/modules/reorder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          modules: ordered.map((m, i) => ({ id: m.id, sort_order: i + 1 })),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Error al guardar el orden de los módulos');
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar el orden de los módulos');
    }
  };

  const moveModule = (fromIndex: number, toIndex: number) => {
    const newModules = [...modules];
    const [moved] = newModules.splice(fromIndex, 1);
    newModules.splice(toIndex, 0, moved);
    const reordered = newModules.map((m, i) => ({ ...m, sort_order: i + 1 }));

    setModules(reordered);
    void persistModuleOrder(reordered);
  };

  // ==================== LESSON ACTIONS ====================
  const handleAddLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const response = await fetch(`/api/admin/academy/modules/${lessonForm.module_id}/lessons`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: lessonForm.title,
          video_url: lessonForm.video_url || null,
          content_text: lessonForm.content_text || null,
          sort_order: lessonForm.sort_order ? parseInt(lessonForm.sort_order) : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Error al crear lección');
      }

      const newLesson = await response.json();
      setLessons(prev => [...prev, newLesson].sort((a, b) => a.sort_order - b.sort_order));
      setLessonForm({ module_id: '', title: '', video_url: '', content_text: '', sort_order: '' });
      setShowAddLesson(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear lección');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateLesson = async (lessonId: string) => {
    const lesson = lessons.find(l => l.id === lessonId);
    if (!lesson) return;

    try {
      const response = await fetch(`/api/admin/academy/lessons/${lessonId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: lesson.title,
          video_url: lesson.video_url,
          content_text: lesson.content_text,
          sort_order: lesson.sort_order,
        }),
      });

      if (!response.ok) throw new Error('Error al actualizar lección');
      setEditingLessonId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar lección');
    }
  };

  const handleDeleteLesson = async (lessonId: string) => {
    if (!window.confirm('¿Eliminar esta lección?')) return;
    
    try {
      const response = await fetch(`/api/admin/academy/lessons/${lessonId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Error al eliminar lección');
      setLessons(prev => prev.filter(l => l.id !== lessonId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar lección');
    }
  };

  // Persiste el orden de las lecciones de un módulo (mismo hallazgo que en módulos:
  // el reordenado vivía solo en el estado de React).
  const persistLessonOrder = async (orderedForModule: Lesson[]) => {
    try {
      const response = await fetch(`/api/admin/academy/lessons/reorder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lessons: orderedForModule.map((l, i) => ({ id: l.id, sort_order: i + 1 })),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Error al guardar el orden de las lecciones');
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar el orden de las lecciones');
    }
  };

  const moveLesson = (lessonId: string, direction: 'up' | 'down') => {
    const targetLesson = lessons.find(l => l.id === lessonId);
    if (!targetLesson) return;

    const moduleLessons = lessons
      .filter(l => l.module_id === targetLesson.module_id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const lessonIndex = moduleLessons.findIndex(l => l.id === lessonId);
    const targetIndex = direction === 'up' ? lessonIndex - 1 : lessonIndex + 1;
    if (targetIndex < 0 || targetIndex >= moduleLessons.length) return;

    const newModuleLessons = [...moduleLessons];
    const [moved] = newModuleLessons.splice(lessonIndex, 1);
    newModuleLessons.splice(targetIndex, 0, moved);
    const withOrder = newModuleLessons.map((l, i) => ({ ...l, sort_order: i + 1 }));

    setLessons(prev => prev.map(l => withOrder.find(nl => nl.id === l.id) || l));
    void persistLessonOrder(withOrder);
  };

  // ==================== QUIZ ACTIONS ====================
  const handleAddQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const validOptions = quizForm.options.filter(opt => opt.trim());
    if (validOptions.length < 2) {
      setError('Se requieren al menos 2 opciones');
      setSaving(false);
      return;
    }

    try {
      const response = await fetch(`/api/admin/academy/courses/${courseId}/quizzes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: quizForm.question,
          options: validOptions,
          correct_index: quizForm.correct_index,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Error al crear pregunta');
      }

      const newQuiz = await response.json();
      setQuizzes(prev => [...prev, newQuiz]);
      setQuizForm({ question: '', options: ['', '', '', ''], correct_index: 0 });
      setShowAddQuiz(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear pregunta');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateQuiz = async (quizId: string) => {
    const quiz = quizzes.find(q => q.id === quizId);
    if (!quiz) return;

    try {
      const response = await fetch(`/api/admin/academy/quizzes/${quizId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: quiz.question,
          options: quiz.options,
          correct_index: quiz.correct_index,
        }),
      });

      if (!response.ok) throw new Error('Error al actualizar pregunta');
      setEditingQuizId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar pregunta');
    }
  };

  const handleDeleteQuiz = async (quizId: string) => {
    if (!window.confirm('¿Eliminar esta pregunta del examen?')) return;
    
    try {
      const response = await fetch(`/api/admin/academy/quizzes/${quizId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Error al eliminar pregunta');
      setQuizzes(prev => prev.filter(q => q.id !== quizId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar pregunta');
    }
  };

  // Helpers
  const getLessonsForModule = (moduleId: string) => {
    return lessons
      .filter(l => l.module_id === moduleId)
      .sort((a, b) => a.sort_order - b.sort_order);
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

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-8 animate-pulse">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-gray-200 rounded-xl"></div>
          <div className="space-y-2 flex-1">
            <div className="h-6 bg-gray-200 rounded-md w-48"></div>
            <div className="h-4 bg-gray-200 rounded-md w-32"></div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-150 p-6 space-y-6">
          <div className="flex gap-4 border-b border-gray-100 pb-3">
            <div className="h-8 bg-gray-200 rounded-lg w-36"></div>
            <div className="h-8 bg-gray-200 rounded-lg w-44"></div>
            <div className="h-8 bg-gray-200 rounded-lg w-32"></div>
          </div>
          <div className="space-y-4">
            <div className="h-12 bg-gray-50 rounded-xl w-full"></div>
            <div className="h-12 bg-gray-50 rounded-xl w-full"></div>
            <div className="h-12 bg-gray-50 rounded-xl w-full"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error && !course) {
    return (
      <div className="max-w-3xl mx-auto text-center p-12">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Error al cargar el curso</h3>
        <p className="text-gray-500 mb-6">{error}</p>
        <Link href="/admin/academia" className="inline-flex items-center gap-2 px-4 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600">
          <ArrowLeft size={18} /> Volver al listado
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/admin/academia"
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all"
          >
            <ArrowLeft size={24} />
          </Link>
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">{course?.title}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                          <span className="px-2 py-0.5 bg-rose-50 text-rose-700 rounded-full">
                            {course?.category ? course.category.charAt(0).toUpperCase() + course.category.slice(1) : '—'}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <GraduationCap className="w-4 h-4" />
                            {course?.badge_name}
                          </span>
                        </div>
          </div>
        </div>
        <Link
          href="/admin/academia/nuevo"
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
        >
          + Nuevo Curso
        </Link>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-800">
          <AlertCircle size={20} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
            <X size={20} />
          </button>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl text-green-800">
          <CheckCircle size={20} />
          <span className="font-medium">Cambios guardados correctamente</span>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 overflow-hidden">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px" aria-label="Tabs">
            <TabButton 
              active={activeTab === 'modules'} 
              onClick={() => setActiveTab('modules')}
              icon={Layers}
            >
              Módulos y Lecciones
            </TabButton>
            <TabButton 
              active={activeTab === 'quizzes'} 
              onClick={() => setActiveTab('quizzes')}
              icon={HelpCircle}
            >
              Examen de Certificación ({quizzes.length})
            </TabButton>
            <TabButton 
              active={activeTab === 'course'} 
              onClick={() => setActiveTab('course')}
              icon={FileText}
            >
              Info del Curso
            </TabButton>
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'modules' && <ModulesTab />}
          {activeTab === 'quizzes' && <QuizzesTab />}
          {activeTab === 'course' && <CourseInfoTab />}
        </div>
      </div>
    </div>
  );

  // ==================== TAB COMPONENTS ====================
  function TabButton({ active, onClick, icon: Icon, children }: { 
    active: boolean; 
    onClick: () => void; 
    icon: React.ComponentType<{ size?: number; className?: string }>;
    children: React.ReactNode;
  }) {
    return (
      <button
        onClick={onClick}
        className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-all ${
          active
            ? 'text-rose-600 border-b-2 border-rose-600'
            : 'text-gray-500 hover:text-gray-700 hover:border-gray-300 border-b-2 border-transparent'
        }`}
      >
        <Icon size={18} />
        {children}
      </button>
    );
  }

  function ModulesTab() {
    return (
      <div className="space-y-6">
        {/* Add Module Form */}
        {showAddModule && (
          <ModuleForm 
            onSubmit={handleAddModule} 
            onCancel={() => setShowAddModule(false)} 
            formData={moduleForm} 
            setFormData={setModuleForm} 
            saving={saving} 
          />
        )}

        {modules.length === 0 && !showAddModule && (
          <div className="text-center py-12">
            <Layers className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No hay módulos aún</h3>
            <p className="text-gray-500 mb-6">Crea el primer módulo para organizar las lecciones del curso</p>
            <button
              onClick={() => setShowAddModule(true)}
              className="inline-flex items-center gap-2 px-5 py-3 bg-rose-500 text-white rounded-xl font-semibold hover:bg-rose-600 transition-colors"
            >
              <Plus size={20} />
              <span>Crear Primer Módulo</span>
            </button>
          </div>
        )}

        <div className="space-y-4">
          {modules.map((module, index) => (
            <ModuleCard
              key={module.id}
              module={module}
              index={index}
              lessons={getLessonsForModule(module.id)}
              expanded={expandedModuleId === module.id}
              editing={editingModuleId === module.id}
              onToggleExpand={() => setExpandedModuleId(expandedModuleId === module.id ? null : module.id)}
              onEditClick={() => setEditingModuleId(editingModuleId === module.id ? null : module.id)}
              onSave={() => handleUpdateModule(module.id)}
              onCancel={() => setEditingModuleId(null)}
              onDelete={() => handleDeleteModule(module.id)}
              onAddLesson={() => setShowAddLesson(module.id)}
              onMoveUp={() => index > 0 && moveModule(index, index - 1)}
              onMoveDown={() => index < modules.length - 1 && moveModule(index, index + 1)}
              formData={module}
              setFormData={(val: Partial<Module>) => setModules(prev => prev.map(m => m.id === module.id ? { ...m, ...val } : m))}
              modulesLength={modules.length}
              showAddLesson={showAddLesson}
              setShowAddLesson={setShowAddLesson}
              lessonForm={lessonForm}
              setLessonForm={setLessonForm}
              modules={modules}
              saving={saving}
              handleAddLesson={handleAddLesson}
              editingLessonId={editingLessonId}
              setEditingLessonId={setEditingLessonId}
              handleUpdateLesson={handleUpdateLesson}
              handleDeleteLesson={handleDeleteLesson}
              moveLesson={moveLesson}
              setLessons={setLessons}
            />
          ))}
        </div>

        {!showAddModule && (
          <button
            onClick={() => setShowAddModule(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-500 hover:border-rose-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
          >
            <Plus size={20} />
            <span className="font-medium">Agregar Módulo</span>
          </button>
        )}
      </div>
    );
  }

  function QuizzesTab() {
    return (
      <div className="space-y-6">
        {showAddQuiz && (
          <QuizForm 
            onSubmit={handleAddQuiz} 
            onCancel={() => setShowAddQuiz(false)} 
            formData={quizForm} 
            setFormData={setQuizForm} 
            saving={saving} 
          />
        )}

        {quizzes.length === 0 && !showAddQuiz ? (
          <div className="text-center py-12">
            <HelpCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No hay preguntas de examen</h3>
            <p className="text-gray-500 mb-6">Agrega preguntas para el examen de certificación (requiere 100% aciertos para aprobar)</p>
            <button
              onClick={() => setShowAddQuiz(true)}
              className="inline-flex items-center gap-2 px-5 py-3 bg-rose-500 text-white rounded-xl font-semibold hover:bg-rose-600 transition-colors"
            >
              <Plus size={20} />
              <span>Agregar Primera Pregunta</span>
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {quizzes.map((quiz, index) => (
                <QuizRow
                  key={quiz.id}
                  quiz={quiz}
                  index={index}
                  editing={editingQuizId === quiz.id}
                  onEditClick={() => setEditingQuizId(editingQuizId === quiz.id ? null : quiz.id)}
                  onSave={() => handleUpdateQuiz(quiz.id)}
                  onCancel={() => setEditingQuizId(null)}
                  onDelete={() => handleDeleteQuiz(quiz.id)}
                  formData={quiz}
                  setFormData={(val: Partial<Quiz>) => setQuizzes(prev => prev.map(q => q.id === quiz.id ? { ...q, ...val } : q))}
                />
              ))}
            </div>
            {!showAddQuiz && (
              <button
                onClick={() => setShowAddQuiz(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-500 hover:border-rose-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
              >
                <Plus size={20} />
                <span className="font-medium">Agregar Pregunta al Examen</span>
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  function CourseInfoTab() {
    return (
      <div className="space-y-6 max-w-2xl">
        <div className="bg-gray-50 rounded-xl p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Información General</h3>
          <dl className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-gray-500">ID</dt>
                <dd className="font-mono text-gray-900 mt-1">{course?.id}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Categoría</dt>
                <dd className="font-medium text-gray-900 mt-1">{course?.category}</dd>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-gray-500">Insignia</dt>
                <dd className="font-medium text-gray-900 mt-1">{course?.badge_name}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Creado</dt>
                <dd className="font-medium text-gray-900 mt-1">
                  {course?.created_at ? new Date(course.created_at).toLocaleDateString('es-ES') : '—'}
                </dd>
              </div>
            </div>
            <div>
              <dt className="text-gray-500">Descripción</dt>
              <dd className="text-gray-900 mt-1 whitespace-pre-wrap">{course?.description}</dd>
            </div>
          </dl>
        </div>

        <div className="bg-gray-50 rounded-xl p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Estadísticas</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatItem label="Módulos" value={modules.length} icon={Layers} color="blue" />
            <StatItem label="Lecciones" value={lessons.length} icon={FileText} color="emerald" />
            <StatItem label="Preguntas Examen" value={quizzes.length} icon={HelpCircle} color="amber" />
            <StatItem label="Certificados" value={stats?.certificatesIssued ?? 0} icon={Award} color="rose" />
          </div>
        </div>
      </div>
    );
  }
}

function StatItem({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  const colorClasses = {
    blue: 'bg-blue-500 bg-blue-50 text-blue-700',
    emerald: 'bg-emerald-500 bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-500 bg-amber-50 text-amber-700',
    rose: 'bg-rose-500 bg-rose-50 text-rose-700',
  };
  
  return (
    <div className="text-center p-4 bg-white rounded-lg border border-gray-200">
      <div className={`p-3 rounded-xl ${colorClasses[color as keyof typeof colorClasses]?.split(' ')[0]} ${colorClasses[color as keyof typeof colorClasses]?.split(' ')[1]} mx-auto w-fit mb-2`}>
        <Icon size={24} className={colorClasses[color as keyof typeof colorClasses]?.split(' ')[2]} />
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function ModuleCard({ 
  module, 
  index, 
  lessons, 
  expanded, 
  editing, 
  onToggleExpand, 
  onEditClick, 
  onSave, 
  onCancel, 
  onDelete, 
  onAddLesson,
  onMoveUp,
  onMoveDown,
  formData,
  setFormData,
  modulesLength,
  showAddLesson,
  setShowAddLesson,
  lessonForm,
  setLessonForm,
  modules,
  saving,
  handleAddLesson,
  editingLessonId,
  setEditingLessonId,
  handleUpdateLesson,
  handleDeleteLesson,
  moveLesson,
  setLessons
}: { 
  module: any; 
  index: number; 
  lessons: any[]; 
  expanded: boolean; 
  editing: boolean; 
  onToggleExpand: () => void; 
  onEditClick: () => void; 
  onSave: () => void; 
  onCancel: () => void; 
  onDelete: () => void; 
  onAddLesson: () => void; 
  onMoveUp: () => void; 
  onMoveDown: () => void; 
  formData: any; 
  setFormData: (prev: any) => any;
  modulesLength: number;
  showAddLesson: string | null;
  setShowAddLesson: (val: string | null) => void;
  lessonForm: any;
  setLessonForm: any;
  modules: any[];
  saving: boolean;
  handleAddLesson: any;
  editingLessonId: string | null;
  setEditingLessonId: (val: string | null) => void;
  handleUpdateLesson: any;
  handleDeleteLesson: any;
  moveLesson: any;
  setLessons: any;
}) {
  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
      {/* Module Header */}
      <div className="p-4 flex items-center gap-4 bg-white border-b border-gray-100">
        <div className="flex items-center gap-2 text-gray-400">
          {index > 0 && (
            <button onClick={onMoveUp} className="p-1 hover:bg-gray-100 rounded" title="Subir">
              <ChevronUp size={18} />
            </button>
          )}
          {index < modulesLength - 1 && (
            <button onClick={onMoveDown} className="p-1 hover:bg-gray-100 rounded" title="Bajar">
              <ChevronDown size={18} />
            </button>
          )}
        </div>
        <GripVertical className="text-gray-300 cursor-grab" size={20} />
        
        {editing ? (
          <input
            type="text"
            value={formData.title}
            onChange={(e) => handleInputChange('title', e.target.value)}
            className="flex-1 px-3 py-2 border border-rose-400 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none font-medium"
            autoFocus
          />
        ) : (
          <h3 className="flex-1 font-semibold text-gray-900 cursor-pointer" onClick={onToggleExpand}>
            {module.title}
          </h3>
        )}

        <span className="text-sm text-gray-500 px-2 py-1 bg-gray-100 rounded-full">
          Orden: {module.sort_order}
        </span>

        <div className="flex items-center gap-2 ml-auto">
          {editing ? (
            <>
              <button onClick={onSave} className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600">Guardar</button>
              <button onClick={onCancel} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200">Cancelar</button>
            </>
          ) : (
            <>
              <button onClick={onEditClick} className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg" title="Editar">
                <Edit size={18} />
              </button>
              <button onClick={onDelete} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Eliminar">
                <Trash2 size={18} />
              </button>
            </>
          )}
          <button 
            onClick={onToggleExpand} 
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
        </div>
      </div>

      {/* Lessons List */}
      {expanded && (
        <div className="p-4 space-y-3 bg-gray-50/50">
          {showAddLesson === module.id && (
            <LessonForm 
              onSubmit={handleAddLesson} 
              onCancel={() => setShowAddLesson(null)} 
              formData={lessonForm} 
              setFormData={setLessonForm} 
              modules={modules}
              preSelectedModuleId={module.id}
              saving={saving}
            />
          )}

          {lessons.length === 0 && !showAddLesson ? (
            <div className="text-center py-8">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 mb-4">Este módulo no tiene lecciones aún</p>
              <button
                onClick={onAddLesson}
                className="inline-flex items-center gap-2 px-4 py-2 bg-rose-500 text-white rounded-lg font-medium hover:bg-rose-600 transition-colors text-sm"
              >
                <Plus size={18} />
                <span>Agregar Primera Lección</span>
              </button>
            </div>
          ) : (
            <>
              {lessons.map((lesson: Lesson, lIndex: number) => (
                <LessonRow
                  key={lesson.id}
                  lesson={lesson}
                  index={lIndex}
                  editing={editingLessonId === lesson.id}
                  onEditClick={() => setEditingLessonId(editingLessonId === lesson.id ? null : lesson.id)}
                  onSave={() => handleUpdateLesson(lesson.id)}
                  onCancel={() => setEditingLessonId(null)}
                  onDelete={() => handleDeleteLesson(lesson.id)}
                  onMoveUp={() => lIndex > 0 && moveLesson(lesson.id, 'up')}
                  onMoveDown={() => lIndex < lessons.length - 1 && moveLesson(lesson.id, 'down')}
                  formData={lesson}
                  setFormData={(val: Partial<Lesson>) => setLessons(prev => prev.map(l => l.id === lesson.id ? { ...l, ...val } : l))}
                  lessons={lessons}
                />
              ))}
              {!showAddLesson && (
                <button
                  onClick={onAddLesson}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-500 hover:border-rose-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
                >
                  <Plus size={20} />
                  <span className="font-medium">Agregar Lección</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LessonRow({ 
  lesson, 
  index, 
  editing, 
  onEditClick, 
  onSave, 
  onCancel, 
  onDelete, 
  onMoveUp,
  onMoveDown,
  formData,
  setFormData,
  lessons
}: { 
  lesson: any; 
  index: number; 
  editing: boolean; 
  onEditClick: () => void; 
  onSave: () => void; 
  onCancel: () => void; 
  onDelete: () => void; 
  onMoveUp: () => void; 
  onMoveDown: () => void; 
  formData: any; 
  setFormData: (prev: any) => any;
  lessons: any[];
}) {
  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-4">
      <div className="flex flex-col gap-1 text-gray-400">
        {index > 0 && <button onClick={onMoveUp} className="p-1 hover:bg-gray-100 rounded" title="Subir"><ChevronUp size={16} /></button>}
        {index < lessons.filter(l => l.module_id === lesson.module_id).length - 1 && (
          <button onClick={onMoveDown} className="p-1 hover:bg-gray-100 rounded" title="Bajar"><ChevronDown size={16} /></button>
        )}
      </div>
      <GripVertical className="text-gray-300 cursor-grab" size={18} />
      
      {editing ? (
        <div className="flex-1 space-y-3">
          <input
            type="text"
            value={formData.title}
            onChange={(e) => handleInputChange('title', e.target.value)}
            className="w-full px-3 py-2 border border-rose-400 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none font-medium"
            placeholder="Título de la lección"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="url"
              value={formData.video_url}
              onChange={(e) => handleInputChange('video_url', e.target.value)}
              placeholder="https://youtube.com/watch?v=... o https://vimeo.com/..."
              className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <input
              type="number"
              value={formData.sort_order}
              onChange={(e) => handleInputChange('sort_order', e.target.value)}
              placeholder="Orden"
              className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none w-24"
              min="1"
            />
          </div>
          <textarea
            value={formData.content_text}
            onChange={(e) => handleInputChange('content_text', e.target.value)}
            rows={3}
            placeholder="Contenido textual de la lección (Markdown soportado)..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y font-mono text-sm"
          />
          <div className="flex gap-2">
            <button onClick={onSave} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600">Guardar</button>
            <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200">Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-w-0" onClick={onEditClick}>
          <div className="flex items-center gap-3 mb-1">
            <span className="font-medium text-gray-900 truncate">{lesson.title}</span>
            {lesson.video_url && (
              <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full flex items-center gap-1">
                <FileText size={12} /> Video
              </span>
            )}
            {lesson.content_text && (
              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs rounded-full flex items-center gap-1">
                <FileText size={12} /> Texto
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 truncate">
            {lesson.content_text ? lesson.content_text.substring(0, 100) + '...' : 'Sin contenido textual'}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        {editing ? (
          <>
            <button onClick={onSave} className="p-2 text-emerald-500 hover:bg-emerald-50 rounded" title="Guardar"><CheckCircle size={20} /></button>
            <button onClick={onCancel} className="p-2 text-gray-400 hover:bg-gray-100 rounded" title="Cancelar"><X size={20} /></button>
          </>
        ) : (
          <>
            <button onClick={onEditClick} className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded" title="Editar"><Edit size={18} /></button>
            <button onClick={onDelete} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Eliminar"><Trash2 size={18} /></button>
          </>
        )}
      </div>
    </div>
  );
}

function ModuleForm({ onSubmit, onCancel, formData, setFormData, saving }: { 
  onSubmit: (e: React.FormEvent) => void; 
  onCancel: () => void; 
  formData: any; 
  setFormData: (prev: any) => any; 
  saving: boolean; 
}) {
  return (
    <form onSubmit={onSubmit} className="bg-white rounded-xl border border-rose-200 p-6 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Layers className="text-rose-500" size={20} />
          Nuevo Módulo
        </h3>
        <button type="button" onClick={onCancel} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Título del Módulo *</label>
        <input
          type="text"
          name="title"
          value={formData.title}
          onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
          placeholder="Ej: Módulo 1: Protocolo de Bioseguridad"
          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none"
          required
          autoFocus
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Orden (opcional)</label>
        <input
          type="number"
          name="sort_order"
          value={formData.sort_order}
          onChange={(e) => setFormData(prev => ({ ...prev, sort_order: e.target.value }))}
          placeholder="Se asignará automáticamente al final"
          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none"
          min="1"
        />
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-700 font-medium border border-gray-300 rounded-xl hover:bg-gray-50">Cancelar</button>
        <button type="submit" disabled={saving} className="px-4 py-2 bg-rose-500 text-white font-medium rounded-xl hover:bg-rose-600 disabled:opacity-50">
          {saving ? 'Guardando...' : 'Crear Módulo'}
        </button>
      </div>
    </form>
  );
}

function LessonForm({ 
  onSubmit, 
  onCancel, 
  formData, 
  setFormData, 
  modules, 
  preSelectedModuleId, 
  saving 
}: { 
  onSubmit: (e: React.FormEvent) => void; 
  onCancel: () => void; 
  formData: any; 
  setFormData: (prev: any) => any; 
  modules: any[]; 
  preSelectedModuleId: string; 
  saving: boolean; 
}) {
  return (
    <form onSubmit={onSubmit} className="bg-white rounded-xl border border-blue-200 p-6 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <FileText className="text-blue-500" size={20} />
          Nueva Lección
        </h3>
        <button type="button" onClick={onCancel} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Módulo *</label>
        <select
          name="module_id"
          value={formData.module_id}
          onChange={(e) => setFormData(prev => ({ ...prev, module_id: e.target.value }))}
          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          required
        >
          <option value="">Seleccionar módulo</option>
          {modules.map(m => (
            <option key={m.id} value={m.id} selected={m.id === preSelectedModuleId}>{m.title}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Título de la Lección *</label>
        <input
          type="text"
          name="title"
          value={formData.title}
          onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
          placeholder="Ej: 1. Esterilización del Instrumental"
          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          required
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">URL del Video (opcional)</label>
          <input
            type="url"
            name="video_url"
            value={formData.video_url}
            onChange={(e) => setFormData(prev => ({ ...prev, video_url: e.target.value }))}
            placeholder="https://youtube.com/watch?v=... o https://vimeo.com/..."
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Orden (opcional)</label>
          <input
            type="number"
            name="sort_order"
            value={formData.sort_order}
            onChange={(e) => setFormData(prev => ({ ...prev, sort_order: e.target.value }))}
            placeholder="Auto"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            min="1"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Contenido Textual (Markdown, opcional)</label>
        <textarea
          name="content_text"
          value={formData.content_text}
          onChange={(e) => setFormData(prev => ({ ...prev, content_text: e.target.value }))}
          rows={4}
          placeholder="Contenido de la lección... Se renderiza con soporte Markdown básico."
          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y font-mono text-sm"
        />
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-700 font-medium border border-gray-300 rounded-xl hover:bg-gray-50">Cancelar</button>
        <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-500 text-white font-medium rounded-xl hover:bg-blue-600 disabled:opacity-50">
          {saving ? 'Guardando...' : 'Crear Lección'}
        </button>
      </div>
    </form>
  );
}

function QuizForm({ onSubmit, onCancel, formData, setFormData, saving }: { 
  onSubmit: (e: React.FormEvent) => void; 
  onCancel: () => void; 
  formData: any; 
  setFormData: (prev: any) => any; 
  saving: boolean; 
}) {
  const handleOptionChange = (index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      options: prev.options.map((opt: string, i: number) => i === index ? value : opt)
    }));
  };

  const handleCorrectIndexChange = (index: number) => {
    setFormData(prev => ({ ...prev, correct_index: index }));
  };

  return (
    <form onSubmit={onSubmit} className="bg-white rounded-xl border border-amber-200 p-6 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <HelpCircle className="text-amber-500" size={20} />
          Nueva Pregunta de Examen
        </h3>
        <button type="button" onClick={onCancel} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Pregunta *</label>
        <textarea
          name="question"
          value={formData.question}
          onChange={(e) => setFormData(prev => ({ ...prev, question: e.target.value }))}
          rows={2}
          placeholder="Ej: ¿Con qué frecuencia deben esterilizarse las herramientas de manicura?"
          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Opciones de Respuesta (mínimo 2) *</label>
        <div className="space-y-2">
          {formData.options.map((option: string, index: number) => (
            <div key={index} className="flex items-center gap-3">
              <input
                type="radio"
                name="correct_index"
                checked={formData.correct_index === index}
                onChange={() => handleCorrectIndexChange(index)}
                className="w-4 h-4 text-amber-500 border-gray-300 focus:ring-amber-500"
              />
              <input
                type="text"
                value={option}
                onChange={(e) => handleOptionChange(index, e.target.value)}
                placeholder={`Opción ${index + 1}`}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
              />
              {formData.options.length > 2 && (
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, options: prev.options.filter((_: string, i: number) => i !== index) }))}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                  title="Eliminar opción"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          ))}
        </div>
        {formData.options.length < 4 && (
          <button
            type="button"
            onClick={() => setFormData(prev => ({ ...prev, options: [...prev.options, ''] }))}
            className="mt-2 text-sm text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1"
          >
            <Plus size={16} /> Agregar otra opción
          </button>
        )}
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-700 font-medium border border-gray-300 rounded-xl hover:bg-gray-50">Cancelar</button>
        <button type="submit" disabled={saving} className="px-4 py-2 bg-amber-500 text-white font-medium rounded-xl hover:bg-amber-600 disabled:opacity-50">
          {saving ? 'Guardando...' : 'Agregar Pregunta'}
        </button>
      </div>
    </form>
  );
}

function QuizRow({ quiz, index, editing, onEditClick, onSave, onCancel, onDelete, formData, setFormData }: any) {
  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleOptionChange = (optIndex: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      options: prev.options.map((opt: string, i: number) => i === optIndex ? value : opt)
    }));
  };

  const handleCorrectChange = (correctIndex: number) => {
    setFormData(prev => ({ ...prev, correct_index: correctIndex }));
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          {editing ? (
            <textarea
              value={formData.question}
              onChange={(e) => handleInputChange('question', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-amber-400 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none font-medium"
            />
          ) : (
            <p className="font-medium text-gray-900">{quiz.question}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button onClick={onSave} className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600">Guardar</button>
              <button onClick={onCancel} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200">Cancelar</button>
            </>
          ) : (
            <>
              <button onClick={onEditClick} className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg" title="Editar"><Edit size={18} /></button>
              <button onClick={onDelete} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Eliminar"><Trash2 size={18} /></button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-2 ml-2 border-l-2 border-gray-100 pl-4">
        {formData.options.map((option: string, optIndex: number) => (
          <div key={optIndex} className="flex items-center gap-3">
            <input
              type="radio"
              name={`correct_${quiz.id}`}
              checked={formData.correct_index === optIndex}
              onChange={() => handleCorrectChange(optIndex)}
              disabled={!editing}
              className="w-4 h-4 text-amber-500 border-gray-300 focus:ring-amber-500"
            />
            {editing ? (
              <input
                type="text"
                value={option}
                onChange={(e) => handleOptionChange(optIndex, e.target.value)}
                className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none text-sm"
              />
            ) : (
              <span className={`text-sm ${formData.correct_index === optIndex ? 'font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded' : 'text-gray-700'}`}>
                {option}
                {formData.correct_index === optIndex && <span className="ml-2 text-emerald-500">✓ Correcta</span>}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}