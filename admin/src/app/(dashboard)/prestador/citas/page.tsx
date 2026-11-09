'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useBookings } from '@/hooks/useBookings';
import { Calendar, Clock, MapPin, Search, User } from 'lucide-react';

export default function PrestadorCitasPage() {
  const { bookings, loading } = useBookings({ rol: 'prestador' });
  const [filterStatus, setFilterStatus] = useState<string>('TODAS');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const filteredBookings = bookings.filter((b) => {
    const matchesStatus = filterStatus === 'TODAS' || b.estado === filterStatus;
    const matchesSearch = 
      (b.service_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (b.client_name || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Mis Citas & Agenda</h2>
          <p className="text-gray-500 mt-1">Gestión detallada de reservas, turnos y servicios asignados</p>
        </div>
        <Link 
          href="/prestador" 
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-colors self-start md:self-auto"
        >
          &larr; Volver al Panel
        </Link>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200/80 flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="relative w-full md:w-80">
          <Search size={18} className="absolute left-3.5 top-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por cliente o servicio..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
          />
        </div>

        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          {['TODAS', 'CONFIRMADA', 'PENDIENTE_PAGO', 'COMPLETADA', 'CANCELADA'].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition-all ${
                filterStatus === status
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {status === 'TODAS' ? 'Todas' : status.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Bookings List */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500">Cargando agenda de citas...</div>
        ) : filteredBookings.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Calendar size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="font-semibold text-gray-600">No se encontraron citas</p>
            <p className="text-xs text-gray-400 mt-1">Intenta cambiando el filtro de búsqueda o estado.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredBookings.map((b) => (
              <div key={b.id} className="p-6 hover:bg-gray-50/50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-gray-900 text-base">{b.service_name}</h3>
                    <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${
                      b.estado === 'CONFIRMADA' ? 'bg-emerald-100 text-emerald-800' :
                      b.estado === 'COMPLETADA' ? 'bg-blue-100 text-blue-800' :
                      b.estado === 'PENDIENTE_PAGO' ? 'bg-amber-100 text-amber-800' :
                      'bg-rose-100 text-rose-800'
                    }`}>
                      {b.estado.replace('_', ' ')}
                    </span>
                  </div>
                  
                  <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-gray-500">
                    <span className="flex items-center gap-1.5 font-medium"><User size={14} className="text-gray-400" /> Cliente: <strong className="text-gray-800">{b.client_name}</strong></span>
                    <span className="flex items-center gap-1.5"><Calendar size={14} className="text-gray-400" /> {new Date(b.scheduled_at).toLocaleDateString()}</span>
                    <span className="flex items-center gap-1.5"><Clock size={14} className="text-gray-400" /> {new Date(b.scheduled_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    {b.service_address && (
                      <span className="flex items-center gap-1.5"><MapPin size={14} className="text-gray-400" /> {b.service_address}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 border-t md:border-t-0 pt-4 md:pt-0">
                  <div className="text-right">
                    <p className="text-xs text-gray-400 uppercase font-semibold">Ganancia Neta</p>
                    <p className="text-lg font-extrabold text-emerald-600">${Number(b.pago_neto_prestador).toLocaleString('es-CO')}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
