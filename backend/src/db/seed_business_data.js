/**
 * GLOWAPP BUSINESS ENGINE SEED DATA
 * Initial seed for verticals, requirements, and document templates.
 */

const verticals = [
  { id: 'vert-beauty-salon', code: 'BEAUTY_SALON', name: 'Peluquería / Salón de Belleza', description: 'Establecimiento de corte, peinado, colorimetría y estética capilar.' },
  { id: 'vert-barbershop', code: 'BARBERSHOP', name: 'Barbería', description: 'Establecimiento especializado en cuidado de barba y corte masculino.' },
  { id: 'vert-spa-massage', code: 'SPA_MASSAGE', name: 'Spa / Centro de Relajación', description: 'Establecimiento de masajes, hidroterapia y bienestar.' },
  { id: 'vert-aesthetics', code: 'AESTHETICS', name: 'Centro de Estética', description: 'Tratamientos faciales y corporales no invasivos.' }
];

const requirements = [
  {
    id: 'req-sanitary-01',
    vertical_id: 'vert-beauty-salon',
    code: 'REQ_SANITARY_CONCEPT',
    title: 'Concepto Sanitario Favorativo',
    description: 'Certificado de inspección sanitaria por la Secretaría de Salud municipal.',
    legal_basis: 'Ley 9 de 1979 / Resolución 2117 de 2010',
    jurisdiction: 'MUNICIPAL',
    domain_context: 'SANITARY',
    evidence_required: 'DOCUMENT',
    frequency_months: 12
  },
  {
    id: 'req-biosecurity-02',
    vertical_id: 'vert-beauty-salon',
    code: 'REQ_BIOSECURITY_PROTOCOL',
    title: 'Protocolo de Bioseguridad y Manejo de Residuos',
    description: 'Manual documentado de esterilización, limpieza y gestión de residuos hospitalarios/similares (RH1).',
    legal_basis: 'Resolución 2827 de 2006 / Ley 1252 de 2008',
    jurisdiction: 'NATIONAL',
    domain_context: 'SANITARY',
    evidence_required: 'DOCUMENT',
    frequency_months: 12
  },
  {
    id: 'req-labor-03',
    vertical_id: 'vert-beauty-salon',
    code: 'REQ_LABOR_CONTRACTS',
    title: 'Contratos Laborales o de Vinculación Formal',
    description: 'Formalización de la relación laboral o comercial con estilistas y colaboradores.',
    legal_basis: 'Código Sustantivo del Trabajo',
    jurisdiction: 'NATIONAL',
    domain_context: 'LABOR',
    evidence_required: 'CONTRACT',
    frequency_months: 24
  },
  {
    id: 'req-sst-04',
    vertical_id: 'vert-beauty-salon',
    code: 'REQ_SST_SYSTEM',
    title: 'Sistema de Gestión de Seguridad y Salud en el Trabajo (SG-SST)',
    description: 'Evaluación de riesgos ergonómicos, químicos y plan de emergencias.',
    legal_basis: 'Decreto 1072 de 2015 / Resolución 0312 de 2019',
    jurisdiction: 'NATIONAL',
    domain_context: 'SST',
    evidence_required: 'DOCUMENT',
    frequency_months: 12
  }
];

const documentTemplates = [
  {
    id: 'tpl-labor-contract',
    code: 'TPL_LABOR_CONTRACT_BEAUTY',
    title: 'Contrato Individual de Trabajo a Término Indefinido (Sector Belleza)',
    category: 'LABOR',
    template_body: `CONTRATO INDIVIDUAL DE TRABAJO
Entre el EMPLEADOR: {{employer_name}} (NIT/CC {{employer_id}})
Y el TRABAJADOR: {{employee_name}} (CC {{employee_id}})
Cargo: {{job_title}}
Salario Base: {{salary}}
Lugar de Desempeño: {{workplace_address}}, {{city}}

CLÁUSULAS:
1. OBJETO: El EMPLEADOR contrata los servicios personales del TRABAJADOR para desempeñar el cargo de {{job_title}}.
2. OBLIGACIONES DE BIOSEGURIDAD: El TRABAJADOR se compromete a cumplir estrictamente con los protocolos de esterilización y bioseguridad del establecimiento.`,
    disclaimer: 'ADVERTENCIA LEGAL: Este documento es una plantilla borrador orientativa. Se recomienda la revisión previa por parte de un abogado laboralista antes de su firma.'
  },
  {
    id: 'tpl-biosecurity-manual',
    code: 'TPL_BIOSECURITY_MANUAL',
    title: 'Manual de Protocolo de Bioseguridad y Gestión RH1',
    category: 'SANITARY',
    template_body: `MANUAL DE BIOSEGURIDAD Y GESTIÓN DE RESIDUOS
Establecimiento: {{business_name}} (NIT {{business_nit}})
Representante Legal: {{owner_name}}
Ubicación: {{city}}, {{address}}

1. PRINCIPIOS GENERALES DE BIOSEGURIDAD:
Uso obligatorio de EPP (Guantes, Tapabocas, Guantes de Nitrilo, Guantes de Látex, Gafas de Protección).
2. DESINFECCIÓN Y ESTERILIZACIÓN DE HERRAMIENTAS:
Uso de Glutaraldehído al 2% o Autoclave para tijeras, peines, cortacutículas y navajas.
3. RUTA Y MANEJO DE RESIDUOS RH1:
Clasificación en caneca roja (residuos biosanitarios y cortopunzantes en guardián).`,
    disclaimer: 'ADVERTENCIA SANITARIA: Este manual borrador debe ser adaptado por el responsable del establecimiento a las condiciones físicas del local.'
  }
];

module.exports = {
  verticals,
  requirements,
  documentTemplates
};
