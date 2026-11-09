'use client';

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { User, Mail, Shield, Phone, Key, Award, CheckCircle2 } from 'lucide-react';

export default function PerfilPage() {
  const { user } = useAuth();
  const [nombre, setNombre] = useState(user?.nombre || '');
  const [phone, setPhone] = useState('+57 300 123 4567');
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Mi Perfil de Usuario</h2>
        <p className="text-gray-500 mt-1">Configuración de cuenta, seguridad e información personal</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 overflow-hidden">
        {/* Banner Header */}
        <div className="bg-gradient-to-r from-rose-500 to-pink-600 p-8 text-white flex items-center gap-6">
          <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-md border-2 border-white/40 flex items-center justify-center font-extrabold text-3xl text-white shadow-lg">
            {user?.nombre ? user.nombre[0].toUpperCase() : 'U'}
          </div>
          <div>
            <h3 className="text-2xl font-bold">{user?.nombre || 'Usuario GlowApp'}</h3>
            <p className="text-rose-100 text-sm font-medium flex items-center gap-2 mt-1">
              <Shield size={16} /> Rol: <strong className="uppercase">{user?.rol || 'USUARIO'}</strong>
            </p>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-8 space-y-6">
          {saved && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm font-bold flex items-center gap-2">
              <CheckCircle2 size={18} /> ¡Perfil actualizado correctamente!
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Nombre Completo</label>
              <div className="relative">
                <User size={18} className="absolute left-3.5 top-3 text-gray-400" />
                <input
                  type="text"
                  required
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Correo Electrónico</label>
              <div className="relative">
                <Mail size={18} className="absolute left-3.5 top-3 text-gray-400" />
                <input
                  type="email"
                  disabled
                  value={user?.email || 'usuario@beautyapp.com'}
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-gray-100 text-gray-500 border border-gray-200 rounded-xl cursor-not-allowed"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Teléfono de Contacto</label>
              <div className="relative">
                <Phone size={18} className="absolute left-3.5 top-3 text-gray-400" />
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Estado de Verificación</label>
              <div className="px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold rounded-xl flex items-center justify-between">
                <span>Cuenta Verificada</span>
                <Award size={18} className="text-emerald-600" />
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-100 flex justify-end">
            <button
              type="submit"
              className="px-6 py-3 bg-rose-500 hover:bg-rose-600 text-white font-bold text-sm rounded-xl shadow-md shadow-rose-500/20 transition-all"
            >
              Guardar Cambios
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
