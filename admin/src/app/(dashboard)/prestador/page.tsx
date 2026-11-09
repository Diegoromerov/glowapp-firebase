'use client';

import React from 'react';
import Link from 'next/link';
import { useBookings } from '@/hooks/useBookings';
import { Calendar, Clock, MapPin, DollarSign, Award, CheckCircle, TrendingUp } from 'lucide-react';

export default function PrestadorDashboard() {
  const { bookings, loading } = useBookings({ rol: 'prestador' });
  
  const reservasPendientes = bookings.filter((b) => b.estado === 'PENDIENTE_PAGO');
  const reservasConfirmadas = bookings.filter((b) => b.estado === 'CONFIRMADA');
  const reservasCompletadas = bookings.filter((b) => b.estado === 'COMPLETADA');

  const totalIngresos = reservasCompletadas.reduce((acc, curr) => acc + Number(curr.pago_neto_prestador), 0);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div>
        <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Panel de Prestador</h2>
        <p className="text-gray-500 mt-1">Gestiona tus servicios, citas y tus ganancias en tiempo real</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200/80 flex items-center gap-4">
          <div className="bg-amber-50 text-amber-500 p-4 rounded-xl">
            <Clock size={24} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pendientes de Pago</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{reservasPendientes.length}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200/80 flex items-center gap-4">
          <div className="bg-emerald-50 text-emerald-500 p-4 rounded-xl">
            <CheckCircle size={24} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Citas Confirmadas</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{reservasConfirmadas.length}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200/80 flex items-center gap-4">
          <div className="bg-rose-50 text-rose-500 p-4 rounded-xl">
            <TrendingUp size={24} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tus Ganancias (Netas)</p>
            <p className="text-2xl font-bold text-gray-950 mt-1">${totalIngresos.toLocaleString('es-CO')}</p>
          </div>
        </div>
      </div>

      {/* Reservation lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Confirmadas */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 overflow-hidden">
          <div className="px-8 py-5 border-b border-gray-100">
            <h3 className="font-bold text-lg text-gray-900">Agenda Confirmada</h3>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-500">Cargando...</div>
          ) : reservasConfirmadas.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No tienes citas confirmadas para hoy.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {reservasConfirmadas.map((booking) => (
                <div key={booking.id} className="p-6 hover:bg-gray-50/50 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-bold text-gray-900">{booking.service_name}</h4>
                    <span className="text-sm font-bold text-emerald-600">${Number(booking.pago_neto_prestador).toLocaleString('es-CO')}</span>
                  </div>
                  <p className="text-sm text-gray-500 mb-3">Cliente: <strong>{booking.client_name}</strong></p>
                  <div className="flex flex-wrap gap-y-1 gap-x-4 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><Calendar size={13} /> {new Date(booking.scheduled_at).toLocaleDateString()}</span>
                    <span className="flex items-center gap-1"><Clock size={13} /> {new Date(booking.scheduled_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    {booking.service_address && (
                      <span className="flex items-center gap-1"><MapPin size={13} /> {booking.service_address}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pendientes */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 overflow-hidden">
          <div className="px-8 py-5 border-b border-gray-100">
            <h3 className="font-bold text-lg text-gray-900">Solicitudes Pendientes</h3>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-500">Cargando...</div>
          ) : reservasPendientes.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No tienes solicitudes pendientes.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {reservasPendientes.map((booking) => (
                <div key={booking.id} className="p-6 hover:bg-gray-50/50 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-bold text-gray-900">{booking.service_name}</h4>
                    <span className="text-sm font-bold text-amber-600">${Number(booking.pago_neto_prestador).toLocaleString('es-CO')}</span>
                  </div>
                  <p className="text-sm text-gray-500 mb-3">Cliente: <strong>{booking.client_name}</strong></p>
                  <div className="flex flex-wrap gap-y-1 gap-x-4 text-xs text-gray-400 mb-4">
                    <span className="flex items-center gap-1"><Calendar size={13} /> {new Date(booking.scheduled_at).toLocaleDateString()}</span>
                    <span className="flex items-center gap-1"><Clock size={13} /> {new Date(booking.scheduled_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                  </div>
                  <div className="flex gap-2">
                    <button className="flex-1 bg-rose-500 hover:bg-rose-600 text-white text-xs font-semibold py-2 px-3 rounded-lg transition-colors">
                      Aceptar Servicio
                    </button>
                    <button className="border border-gray-200 hover:bg-gray-50 text-gray-600 text-xs font-semibold py-2 px-3 rounded-lg transition-colors">
                      Rechazar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
