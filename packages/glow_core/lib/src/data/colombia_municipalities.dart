/// Lista canónica de ciudades y principales municipios de Colombia con sus departamentos
const List<String> colombiaMunicipalities = [
  // Cundinamarca & D.C.
  'Bogotá D.C. (Cundinamarca)',
  'Soacha (Cundinamarca)',
  'Chía (Cundinamarca)',
  'Zipaquirá (Cundinamarca)',
  'Facatativá (Cundinamarca)',
  'Fusagasugá (Cundinamarca)',
  'Mosquera (Cundinamarca)',
  'Madrid (Cundinamarca)',
  'Funza (Cundinamarca)',
  'Cajicá (Cundinamarca)',
  'Girardot (Cundinamarca)',
  'Cota (Cundinamarca)',
  'Sopó (Cundinamarca)',
  'La Calera (Cundinamarca)',
  'Tabio (Cundinamarca)',
  'Tenjo (Cundinamarca)',
  'Tocancipá (Cundinamarca)',
  'Gachancipá (Cundinamarca)',
  'Villeta (Cundinamarca)',
  'Pacho (Cundinamarca)',
  'Ubaté (Cundinamarca)',

  // Antioquia
  'Medellín (Antioquia)',
  'Bello (Antioquia)',
  'Itagüí (Antioquia)',
  'Envigado (Antioquia)',
  'Apartadó (Antioquia)',
  'Rionegro (Antioquia)',
  'Sabaneta (Antioquia)',
  'La Estrella (Antioquia)',
  'Caldas (Antioquia)',
  'Copacabana (Antioquia)',
  'Girardota (Antioquia)',
  'Marinilla (Antioquia)',
  'Guarne (Antioquia)',
  'El Carmen de Viboral (Antioquia)',
  'La Ceja (Antioquia)',
  'Caucasia (Antioquia)',
  'Turbo (Antioquia)',
  'Chigorodó (Antioquia)',
  'Santa Fe de Antioquia (Antioquia)',
  'Yarumal (Antioquia)',
  'Amagá (Antioquia)',
  'Andes (Antioquia)',
  'Ciudad Bolívar (Antioquia)',

  // Valle del Cauca
  'Cali (Valle del Cauca)',
  'Buenaventura (Valle del Cauca)',
  'Palmira (Valle del Cauca)',
  'Tuluá (Valle del Cauca)',
  'Yumbo (Valle del Cauca)',
  'Cartago (Valle del Cauca)',
  'Buga (Valle del Cauca)',
  'Jamundí (Valle del Cauca)',
  'Candelaria (Valle del Cauca)',
  'Florida (Valle del Cauca)',
  'Pradera (Valle del Cauca)',
  'Zarzal (Valle del Cauca)',
  'Sevilla (Valle del Cauca)',
  'Roldanillo (Valle del Cauca)',
  'Caicedonia (Valle del Cauca)',
  'El Cerrito (Valle del Cauca)',
  'Ginebra (Valle del Cauca)',

  // Atlántico
  'Barranquilla (Atlántico)',
  'Soledad (Atlántico)',
  'Malambo (Atlántico)',
  'Sabanalarga (Atlántico)',
  'Baranoa (Atlántico)',
  'Galapa (Atlántico)',
  'Puerto Colombia (Atlántico)',
  'Palmar de Varela (Atlántico)',
  'Santo Tomás (Atlántico)',
  'Sabanagrande (Atlántico)',

  // Bolívar
  'Cartagena (Bolívar)',
  'Magangué (Bolívar)',
  'Turbaco (Bolívar)',
  'Arjona (Bolívar)',
  'El Carmen de Bolívar (Bolívar)',
  'Mompós (Bolívar)',
  'San Juan Nepomuceno (Bolívar)',

  // Santander
  'Bucaramanga (Santander)',
  'Floridablanca (Santander)',
  'Girón (Santander)',
  'Piedecuesta (Santander)',
  'Barrancabermeja (Santander)',
  'San Gil (Santander)',
  'Socorro (Santander)',
  'Málaga (Santander)',
  'Barbosa (Santander)',
  'Lebrija (Santander)',
  'Rionegro (Santander)',
  'Cimitarra (Santander)',

  // Norte de Santander
  'Cúcuta (Norte de Santander)',
  'Ocaña (Norte de Santander)',
  'Villa del Rosario (Norte de Santander)',
  'Los Patios (Norte de Santander)',
  'Pamplona (Norte de Santander)',
  'Tibú (Norte de Santander)',
  'El Zulia (Norte de Santander)',
  'Chinácota (Norte de Santander)',

  // Risaralda
  'Pereira (Risaralda)',
  'Dosquebradas (Risaralda)',
  'Santa Rosa de Cabal (Risaralda)',
  'La Virginia (Risaralda)',
  'Belén de Umbría (Risaralda)',
  'Santuario (Risaralda)',
  'Quinchía (Risaralda)',

  // Caldas
  'Manizales (Caldas)',
  'La Dorada (Caldas)',
  'Chinchiná (Caldas)',
  'Villamaría (Caldas)',
  'Anserma (Caldas)',
  'Riosucio (Caldas)',
  'Salamina (Caldas)',
  'Aguadas (Caldas)',
  'Neira (Caldas)',

  // Quindío
  'Armenia (Quindío)',
  'Calarcá (Quindío)',
  'Montenegro (Quindío)',
  'Quimbaya (Quindío)',
  'La Tebaida (Quindío)',
  'Circasia (Quindío)',
  'Filandia (Quindío)',
  'Salento (Quindío)',

  // Tolima
  'Ibagué (Tolima)',
  'Espinal (Tolima)',
  'Melgar (Tolima)',
  'Chaparral (Tolima)',
  'Líbano (Tolima)',
  'Mariquita (Tolima)',
  'Honda (Tolima)',
  'Flandes (Tolima)',
  'Guamo (Tolima)',
  'Fresno (Tolima)',
  'Purificación (Tolima)',

  // Huila
  'Neiva (Huila)',
  'Pitalito (Huila)',
  'Garzón (Huila)',
  'La Plata (Huila)',
  'Campoalegre (Huila)',
  'Palermo (Huila)',
  'San Agustín (Huila)',
  'Gigante (Huila)',

  // Meta
  'Villavicencio (Meta)',
  'Acacías (Meta)',
  'Granada (Meta)',
  'Puerto López (Meta)',
  'Cumaral (Meta)',
  'San Martín (Meta)',
  'Restrepo (Meta)',
  'Puerto Gaitán (Meta)',

  // Magdalena
  'Santa Marta (Magdalena)',
  'Ciénaga (Magdalena)',
  'Fundación (Magdalena)',
  'Plato (Magdalena)',
  'El Banco (Magdalena)',
  'Aracataca (Magdalena)',
  'Pivijay (Magdalena)',

  // Cesar
  'Valledupar (Cesar)',
  'Aguachica (Cesar)',
  'Agustín Codazzi (Cesar)',
  'Bosconia (Cesar)',
  'Curumaní (Cesar)',
  'El Copey (Cesar)',
  'La Paz (Cesar)',
  'Chiriguaná (Cesar)',

  // Córdoba
  'Montería (Córdoba)',
  'Lorica (Córdoba)',
  'Cereté (Córdoba)',
  'Sahagún (Córdoba)',
  'Montelíbano (Córdoba)',
  'Planeta Rica (Córdoba)',
  'Tierralta (Córdoba)',
  'Ciénaga de Oro (Córdoba)',

  // Nariño
  'Pasto (Nariño)',
  'Tumaco (Nariño)',
  'Ipiales (Nariño)',
  'Túquerres (Nariño)',
  'Samaniego (Nariño)',
  'La Unión (Nariño)',
  'Sandoná (Nariño)',

  // Cauca
  'Popayán (Cauca)',
  'Santander de Quilichao (Cauca)',
  'Puerto Tejada (Cauca)',
  'Patía (Cauca)',
  'Piendamó (Cauca)',
  'Miranda (Cauca)',
  'Corinto (Cauca)',
  'El Tambo (Cauca)',

  // Boyacá
  'Tunja (Boyacá)',
  'Duitama (Boyacá)',
  'Sogamoso (Boyacá)',
  'Chiquinquirá (Boyacá)',
  'Puerto Boyacá (Boyacá)',
  'Paipa (Boyacá)',
  'Moniquirá (Boyacá)',
  'Villa de Leyva (Boyacá)',
  'Garagoa (Boyacá)',
  'Nobsa (Boyacá)',

  // Sucre
  'Sincelejo (Sucre)',
  'Corozal (Sucre)',
  'San Marcos (Sucre)',
  'San Onofre (Sucre)',
  'Tolú (Sucre)',
  'Sampués (Sucre)',
  'Coveñas (Sucre)',

  // La Guajira
  'Riohacha (La Guajira)',
  'Maicao (La Guajira)',
  'Uribia (La Guajira)',
  'Manaure (La Guajira)',
  'San Juan del Cesar (La Guajira)',
  'Fonseca (La Guajira)',
  'Villanueva (La Guajira)',

  // Casanare
  'Yopal (Casanare)',
  'Aguazul (Casanare)',
  'Villanueva (Casanare)',
  'Tauramena (Casanare)',
  'Paz de Ariporo (Casanare)',
  'Monterrey (Casanare)',

  // Caquetá
  'Florencia (Caquetá)',
  'San Vicente del Caguán (Caquetá)',
  'Cartagena del Chairá (Caquetá)',
  'Puerto Rico (Caquetá)',

  // Putumayo
  'Mocoa (Putumayo)',
  'Puerto Asís (Putumayo)',
  'Orito (Putumayo)',
  'Valle del Guamuez (Putumayo)',

  // Chocó
  'Quibdó (Chocó)',
  'Istmina (Chocó)',
  'Tadó (Chocó)',
  'Condoto (Chocó)',
  'Bahía Solano (Chocó)',

  // Arauca
  'Arauca (Arauca)',
  'Tame (Arauca)',
  'Saravena (Arauca)',
  'Arauquita (Arauca)',

  // Guaviare
  'San José del Guaviare (Guaviare)',
  'El Retorno (Guaviare)',

  // San Andrés y Providencia
  'San Andrés (Archipiélago de San Andrés)',
  'Providencia (Archipiélago de San Andrés)',

  // Amazonas
  'Leticia (Amazonas)',
  'Puerto Nariño (Amazonas)',

  // Vichada
  'Puerto Carreño (Vichada)',
  'La Primavera (Vichada)',

  // Guainía
  'Inírida (Guainía)',

  // Vaupés
  'Mitú (Vaupés)',
];
