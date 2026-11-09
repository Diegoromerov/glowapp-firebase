'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useBookings } from '@/hooks/useBookings';
import { Calendar, Clock, MapPin, Search, UserCheck } from 'lucide-react';

export default function ClienteCitasPage() {
  const { bookings, loading, cancelBooking } = useBookings({ rol: 'cliente' });
  const [filterStatus, setFilterStatus] = useState<string>('TODAS');

  const filteredBookings = bookings.filter((b) => {
    return filterStatus === 'TODAS' || b.estado === filterStatus;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Mis Citas & Reservas</h2>
          <p className="text-gray-500 mt-1">Historial y próximas citas de belleza agendadas</p>
        </div>
        <div className="flex gap-3">
          <Link 
            href="/cliente/nueva-cita" 
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors"
          >
            + Nueva Cita
          </Link>
          <Link 
            href="/cliente" 
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-colors"
          >
            &larr; Volver
          </Link>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200/80 flex flex-wrap gap-2">
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

      {/* Bookings List */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500">Cargando tus citas...</div>
        ) : filteredBookings.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Calendar size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="font-semibold text-gray-600">No tienes citas registradas en este estado</p>
            <Link href="/cliente/nueva-cita" className="inline-block mt-3 text-rose-500 font-semibold text-sm hover:underline">
              Agendar una nueva cita de belleza &rarr;
            </Link>
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
                    <span className="flex items-center gap-1.5 font-medium"><UserCheck size={14} className="text-gray-400" /> Prestador: <strong className="text-gray-800">{b.provider_name || 'Asignado'}</strong></span>
                    <span className="flex items-center gap-1.5"><Calendar size={14} className="text-gray-400" /> {new Date(b.scheduled_at).toLocaleDateString()}</span>
                    <span className="flex items-center gap-1.5"><Clock size={14} className="text-gray-400" /> {new Date(b.scheduled_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    {b.service_address && (
                      <span className="flex items-center gap-1.5"><MapPin size={14} className="text-gray-400" /> {b.service_address}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-gray-400 uppercase font-semibold">Valor Total</p>
                    <p className="text-lg font-extrabold text-gray-900">${Number(b.valor_bruto).toLocaleString('es-CO')}</p>
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
