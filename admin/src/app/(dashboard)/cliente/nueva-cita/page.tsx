'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Calendar, Clock, MapPin, Scissors, Check, Sparkles } from 'lucide-react';

export default function NuevaCitaPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [selectedService, setSelectedService] = useState('');
  const [selectedAddress, setSelectedAddress] = useState('Calle 26 # 68-10, Fontibón, Bogotá');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedTime, setSelectedTime] = useState('10:00');
  const [loading, setLoading] = useState(false);

  const serviciosDisponibles = [
    { id: '1', nombre: 'Corte + Cepillado Velvet', precio: 65000, duracion: '60 min', categoria: 'Peluquería' },
    { id: '2', nombre: 'Manicura Semipermanente Luxe', precio: 55000, duracion: '45 min', categoria: 'Uñas' },
    { id: '3', nombre: 'Tratamiento Piel Seda Dermo', precio: 120000, duracion: '90 min', categoria: 'Facial' },
    { id: '4', nombre: 'Diseño de Cejas & Henna', precio: 45000, duracion: '30 min', categoria: 'Mirada' },
  ];

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    setTimeout(() => {
      setLoading(false);
      alert('¡Cita solicitada con éxito! Redirigiendo a tus citas...');
      router.push('/cliente/citas');
    }, 1200);
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Agendar Nueva Cita</h2>
          <p className="text-gray-500 mt-1">Selecciona el servicio de belleza a domicilio deseado</p>
        </div>
        <Link 
          href="/cliente" 
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-colors"
        >
          &larr; Cancelar
        </Link>
      </div>

      <form onSubmit={handleBookingSubmit} className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200/80 space-y-8">
        {/* Paso 1: Seleccionar Servicio */}
        <div>
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-7 h-7 bg-rose-500 text-white rounded-full text-xs flex items-center justify-center font-bold">1</span>
            Elige el servicio
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {serviciosDisponibles.map((serv) => (
              <div
                key={serv.id}
                onClick={() => setSelectedService(serv.id)}
                className={`p-5 rounded-xl border-2 cursor-pointer transition-all ${
                  selectedService === serv.id
                    ? 'border-rose-500 bg-rose-50/30 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-bold text-gray-900">{serv.nombre}</h4>
                  <span className="text-xs font-bold text-rose-500 px-2 py-0.5 bg-rose-50 rounded-full">{serv.categoria}</span>
                </div>
                <div className="flex justify-between items-center text-sm mt-4">
                  <span className="text-gray-500 flex items-center gap-1 text-xs"><Clock size={14} /> {serv.duracion}</span>
                  <span className="font-extrabold text-gray-900 text-base">${serv.precio.toLocaleString('es-CO')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Paso 2: Dirección y Fecha */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-gray-100">
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Dirección del Servicio</label>
            <div className="relative">
              <MapPin size={18} className="absolute left-3.5 top-3 text-gray-400" />
              <input
                type="text"
                required
                value={selectedAddress}
                onChange={(e) => setSelectedAddress(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Fecha</label>
              <input
                type="date"
                required
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Hora</label>
              <input
                type="time"
                required
                value={selectedTime}
                onChange={(e) => setSelectedTime(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="pt-4 border-t border-gray-100 flex justify-end">
          <button
            type="submit"
            disabled={!selectedService || loading}
            className="w-full md:w-auto px-8 py-3.5 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-lg shadow-rose-500/20 transition-all flex items-center justify-center gap-2"
          >
            {loading ? 'Confirmando Cita...' : 'Confirmar Reserva de Servicio'}
          </button>
        </div>
      </form>
    </div>
  );
}
