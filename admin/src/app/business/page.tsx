'use client';

import React, { useState } from 'react';

export default function AdminBusinessAuditPage() {
  const [activeTab, setActiveTab] = useState('audit');

  const businessAudits = [
    {
      id: 'biz-01',
      name: 'Peluquería Studio SAS',
      owner: 'Carlos Gómez',
      vertical: 'Peluquería / Salón',
      onboardingMode: 'NEGOCIO NUEVO',
      stage: 'CONSTITUCIÓN',
      complianceScore: 65,
      openFindings: 1,
      status: 'REQUIERE_VERIFICACION'
    },
    {
      id: 'biz-02',
      name: 'Barbería El Galán',
      owner: 'Javier Ramírez',
      vertical: 'Barbería',
      onboardingMode: 'NEGOCIO EXISTENTE',
      stage: 'AUDITORÍA',
      complianceScore: 45,
      openFindings: 2,
      status: 'EVIDENCIA_SUBIDA'
    }
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">GlowApp Business — Centro de Auditoría & Cumplimiento</h1>
          <p className="text-slate-500 text-sm">Supervisión administrativa de expedientes de negocio, trámites sanitarios y verificación de evidencias.</p>
        </div>
        <div className="flex space-x-2">
          <span className="px-3 py-1 bg-rose-100 text-rose-700 text-xs font-semibold rounded-full">GlowApp Phase 2 Active</span>
          <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-full">Business Engine v1.0</span>
        </div>
      </div>

      {/* Scorecards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs text-slate-500 font-medium">Negocios Registrados</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">128</p>
        </div>
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs text-slate-500 font-medium">Puntaje Promedio Cumplimiento</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">72.4%</p>
        </div>
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs text-slate-500 font-medium">Evidencias por Verificar</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">14</p>
        </div>
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs text-slate-500 font-medium">Hallazgos Abiertos</p>
          <p className="text-2xl font-bold text-rose-600 mt-1">9</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
          <h2 className="font-semibold text-slate-900 text-sm">Cola de Expedientes & Diagnósticos Business</h2>
        </div>
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-100 text-slate-700 text-xs uppercase font-semibold">
            <tr>
              <th className="px-6 py-3">Establecimiento</th>
              <th className="px-6 py-3">Vertical</th>
              <th className="px-6 py-3">Modalidad</th>
              <th className="px-6 py-3">Etapa</th>
              <th className="px-6 py-3">Cumplimiento</th>
              <th className="px-6 py-3">Estado</th>
              <th className="px-6 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {businessAudits.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 font-semibold text-slate-900">
                  {item.name}
                  <span className="block text-xs text-slate-400 font-normal">{item.owner}</span>
                </td>
                <td className="px-6 py-4">{item.vertical}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-0.5 text-xs rounded font-medium ${item.onboardingMode === 'NEGOCIO NUEVO' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                    {item.onboardingMode}
                  </span>
                </td>
                <td className="px-6 py-4 font-medium">{item.stage}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center space-x-2">
                    <div className="w-16 bg-slate-200 rounded-full h-2">
                      <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${item.complianceScore}%` }}></div>
                    </div>
                    <span className="text-xs font-bold text-slate-700">{item.complianceScore}%</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="px-2.5 py-1 bg-amber-100 text-amber-800 text-xs font-semibold rounded-full">
                    {item.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white text-xs font-medium rounded-lg transition-colors">
                    Revisar Evidencias
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
