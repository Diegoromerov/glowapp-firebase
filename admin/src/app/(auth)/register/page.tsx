'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Scissors, Mail, Lock, User, Phone, Briefcase } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState('PRESTADOR');
  const [loading, setLoading] = useState(false);

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    setTimeout(() => {
      setLoading(false);
      alert('¡Registro exitoso! Por favor inicia sesión con tus credenciales.');
      router.push('/login');
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-8">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 bg-rose-500 text-white rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-rose-500/30">
            <Scissors size={26} />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-wide">Crear Cuenta en GlowApp</h1>
          <p className="text-xs text-slate-400">Únete a la plataforma líder de belleza y bienestar</p>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">Nombre Completo</label>
            <div className="relative">
              <User size={18} className="absolute left-3.5 top-3.5 text-slate-500" />
              <input
                type="text"
                required
                placeholder="Ej. Ana Silva"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="w-full pl-10 pr-4 py-3 text-sm bg-slate-800 border border-slate-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">Correo Electrónico</label>
            <div className="relative">
              <Mail size={18} className="absolute left-3.5 top-3.5 text-slate-500" />
              <input
                type="email"
                required
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-3 text-sm bg-slate-800 border border-slate-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">Contraseña</label>
            <div className="relative">
              <Lock size={18} className="absolute left-3.5 top-3.5 text-slate-500" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 text-sm bg-slate-800 border border-slate-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">Tipo de Perfil</label>
            <select
              value={rol}
              onChange={(e) => setRol(e.target.value)}
              className="w-full px-4 py-3 text-sm bg-slate-800 border border-slate-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
            >
              <option value="PRESTADOR">Prestador / Estilista / Salón</option>
              <option value="CLIENTE">Cliente Final</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-lg shadow-rose-500/25 transition-all mt-4"
          >
            {loading ? 'Creando Cuenta...' : 'Registrarme'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-400">
          ¿Ya tienes una cuenta?{' '}
          <Link href="/login" className="font-semibold text-rose-400 hover:text-rose-300">
            Inicia Sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
