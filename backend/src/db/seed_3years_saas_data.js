// backend/src/db/seed_3years_saas_data.js
//
// Siembra 3 años de historia SaaS sobre el harness en memoria (src/config/pgMemory.js).
// USE_PG_MEM se fija ANTES de cualquier require a propósito: el harness tiene prioridad sobre
// DATABASE_URL, de modo que este script nunca puede escribir en una base real.
// Todo se escribe a través de los modelos de Sequelize (sin SQL crudo).
process.env.USE_PG_MEM = 'true';
const { sequelize } = require('../config/database');
const { User, BusinessProfile, Membership, Service, Booking, Transaction } = require('../models');

/**
 * 🚀 SCRIPT DE SIEMBRA COMPLETO: 3 AÑOS DE HISTORIAL SAAS Y MULTI-TENANCY
 * Simula el ecosistema real de un Propietario (Carlos Mendoza) operando 3 sedes desde 2023 hasta 2026.
 */

async function seed3YearsData() {
  console.log('🌱 Iniciando siembra de datos de 3 años para GlowApp SaaS...');

  try {
    // 1. Crear o recuperar el Usuario Propietario Principal
    let ownerUser = await User.findOne({ where: { email: 'propietario@salonglow.com' } });
    if (!ownerUser) {
      ownerUser = await User.create({
        nombre: 'Carlos Mendoza (Propietario GlowApp)',
        email: 'propietario@salonglow.com',
        // N-15: placeholder, NO hash (un hash versionado es el defecto N-2) ni comentario
        // con la clave en claro (Regla 8 de N-10).
        password_hash: '__SEED_PASSWORD_HASH__',
        phone: '3009876543',
        auth_provider: 'LOCAL',
        rol: 'PRESTADOR',
        worker_type: 'ADMIN_SALON',
        onboarding_completo: true,
        is_active: true
      });
      console.log('✅ Usuario Propietario creado: Carlos Mendoza (ID:', ownerUser.id, ')');
    } else {
      console.log('ℹ️ Usuario Propietario existente: Carlos Mendoza (ID:', ownerUser.id, ')');
    }

    // 2. Crear Usuarios de Equipo (Administradores y Estilistas)
    const staffData = [
      { nombre: 'Laura Gómez (Admin)', email: 'laura.admin@salonglow.com', phone: '3101112233', rol: 'PRESTADOR', worker_type: 'EMPLEADO' },
      { nombre: 'Valentina Ríos (Manager)', email: 'valentina.mgr@salonglow.com', phone: '3102223344', rol: 'PRESTADOR', worker_type: 'EMPLEADO' },
      { nombre: 'Sofía Martínez (Colorista)', email: 'sofia.color@salonglow.com', phone: '3103334455', rol: 'PRESTADOR', worker_type: 'PRESTADOR_SERVICIO' },
      { nombre: 'Daniela Vargas (Manicurista)', email: 'daniela.nails@salonglow.com', phone: '3104445566', rol: 'PRESTADOR', worker_type: 'PRESTADOR_SERVICIO' },
      { nombre: 'Camilo Torres (Barbero)', email: 'camilo.barber@salonglow.com', phone: '3105556677', rol: 'PRESTADOR', worker_type: 'PRESTADOR_SERVICIO' }
    ];

    const staffUsers = [];
    for (const data of staffData) {
      let u = await User.findOne({ where: { email: data.email } });
      if (!u) {
        u = await User.create({
          ...data,
          password_hash: '__SEED_PASSWORD_HASH__',
          auth_provider: 'LOCAL',
          onboarding_completo: true,
          is_active: true
        });
      }
      staffUsers.push(u);
    }
    console.log(`✅ ${staffUsers.length} miembros del equipo verificados/creados.`);

    // 3. Crear 3 Sedes (Business Profiles) de Carlos Mendoza
    const sedesData = [
      {
        id: 'bp-glow-norte',
        name: 'GlowApp Salón & Spa Sede Norte',
        slug: 'glowapp-norte-bogota',
        city: 'Bogotá',
        address: 'Calle 127 # 15-45, Usaquén',
        phone: '6017459001',
        email: 'norte@salonglow.com',
        vertical_code: 'BEAUTY_SALON',
        status: 'ACTIVE'
      },
      {
        id: 'bp-glow-chapinero',
        name: 'GlowApp Barbería & Estética Chapinero',
        slug: 'glowapp-chapinero-bogota',
        city: 'Bogotá',
        address: 'Carrera 7 # 58-20, Chapinero',
        phone: '6017459002',
        email: 'chapinero@salonglow.com',
        vertical_code: 'BARBERSHOP',
        status: 'ACTIVE'
      },
      {
        id: 'bp-glow-zonat',
        name: 'GlowApp Centro de Estética Zona T',
        slug: 'glowapp-zonat-bogota',
        city: 'Bogotá',
        address: 'Calle 82 # 12-18, Zona Rosa',
        phone: '6017459003',
        email: 'zonat@salonglow.com',
        vertical_code: 'SPA_MASSAGE',
        status: 'ACTIVE'
      }
    ];

    const businessProfiles = [];
    for (const data of sedesData) {
      let bp = await BusinessProfile.findByPk(data.id);
      if (!bp) {
        bp = await BusinessProfile.create(data);
      }
      businessProfiles.push(bp);
    }
    console.log(`✅ ${businessProfiles.length} sedes de Carlos Mendoza listas (Norte, Chapinero, Zona T).`);

    // 4. Crear Membresías (Memberships) vinculando a Carlos Mendoza y su equipo
    const membershipsToCreate = [
      // Carlos Mendoza es OWNER en las 3 sedes
      { user_id: ownerUser.id, business_profile_id: 'bp-glow-norte', role: 'OWNER', status: 'ACTIVE' },
      { user_id: ownerUser.id, business_profile_id: 'bp-glow-chapinero', role: 'OWNER', status: 'ACTIVE' },
      { user_id: ownerUser.id, business_profile_id: 'bp-glow-zonat', role: 'OWNER', status: 'ACTIVE' },

      // Equipo asignado a Sede Norte
      { user_id: staffUsers[0].id, business_profile_id: 'bp-glow-norte', role: 'ADMIN', status: 'ACTIVE' },
      { user_id: staffUsers[2].id, business_profile_id: 'bp-glow-norte', role: 'MEMBER', status: 'ACTIVE' },
      { user_id: staffUsers[3].id, business_profile_id: 'bp-glow-norte', role: 'MEMBER', status: 'ACTIVE' },

      // Equipo asignado a Sede Chapinero
      { user_id: staffUsers[1].id, business_profile_id: 'bp-glow-chapinero', role: 'MANAGER', status: 'ACTIVE' },
      { user_id: staffUsers[4].id, business_profile_id: 'bp-glow-chapinero', role: 'MEMBER', status: 'ACTIVE' },

      // Equipo asignado a Sede Zona T
      { user_id: staffUsers[2].id, business_profile_id: 'bp-glow-zonat', role: 'MEMBER', status: 'ACTIVE' }
    ];

    for (const memData of membershipsToCreate) {
      const existing = await Membership.findOne({
        where: { user_id: memData.user_id, business_profile_id: memData.business_profile_id }
      });
      if (!existing) {
        await Membership.create({
          ...memData,
          accepted_at: new Date('2023-01-15T09:00:00Z'),
          created_by_user_id: ownerUser.id
        });
      }
    }
    console.log('✅ Membresías asignadas con roles (OWNER en 3 sedes, ADMIN, MANAGER, MEMBER).');

    // 5. Crear Servicios en las 3 Sedes
    const servicesData = [
      // Sede Norte (Salón de Belleza)
      { id: 'srv-norte-01', provider_id: ownerUser.id, business_profile_id: 'bp-glow-norte', name: 'Balayage & Colorimetría Premium', price: 280000, duration_minutes: 180, category: 'Color' },
      { id: 'srv-norte-02', provider_id: ownerUser.id, business_profile_id: 'bp-glow-norte', name: 'Corte de Dama & Cepillado Glam', price: 95000, duration_minutes: 60, category: 'Corte' },
      { id: 'srv-norte-03', provider_id: ownerUser.id, business_profile_id: 'bp-glow-norte', name: 'Tratamiento Reconstructivo Keratina', price: 320000, duration_minutes: 150, category: 'Tratamientos' },
      
      // Sede Chapinero (Barbería)
      { id: 'srv-chapi-01', provider_id: ownerUser.id, business_profile_id: 'bp-glow-chapinero', name: 'Corte Masculino & Ritual de Barba', price: 75000, duration_minutes: 50, category: 'Barbería' },
      { id: 'srv-chapi-02', provider_id: ownerUser.id, business_profile_id: 'bp-glow-chapinero', name: 'Manicura Spa & Masaje de Manos', price: 45000, duration_minutes: 40, category: 'Uñas' },

      // Sede Zona T (Spa & Estética)
      { id: 'srv-zonat-01', provider_id: ownerUser.id, business_profile_id: 'bp-glow-zonat', name: 'Limpieza Facial Profunda con IA AURA', price: 180000, duration_minutes: 75, category: 'Facial' },
      { id: 'srv-zonat-02', provider_id: ownerUser.id, business_profile_id: 'bp-glow-zonat', name: 'Masaje Relajante Piedras Volcánicas', price: 160000, duration_minutes: 60, category: 'Spa' }
    ];

    for (const srvData of servicesData) {
      let srv = await Service.findByPk(srvData.id);
      if (!srv) {
        await Service.create({
          ...srvData,
          description: `Servicio profesional exclusivo de ${srvData.name}`,
          is_active: true
        });
      }
    }
    console.log('✅ Catálogo de servicios creado para las 3 sedes.');

    // 6. Crear Cliente Demo
    let clientUser = await User.findOne({ where: { email: 'cliente.vip@glowapp.com' } });
    if (!clientUser) {
      clientUser = await User.create({
        nombre: 'Carolina Restrepo (Cliente VIP)',
        email: 'cliente.vip@glowapp.com',
        password_hash: '__SEED_PASSWORD_HASH__',
        phone: '3159998877',
        auth_provider: 'LOCAL',
        rol: 'CLIENTE',
        onboarding_completo: true,
        is_active: true
      });
    }

    // 7. Generar Historial de Reservas y Transacciones de 3 Años (2023 - 2026)
    const years = [2023, 2024, 2025, 2026];
    let bookingCount = 0;

    for (const year of years) {
      const months = year === 2026 ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [1, 3, 5, 7, 9, 11];
      for (const month of months) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-15 14:00:00+00`;
        const dateObj = new Date(dateStr);

        // Crear reserva en Sede Norte
        const bNorte = await Booking.create({
          client_id: clientUser.id,
          provider_id: ownerUser.id,
          service_id: 'srv-norte-01',
          business_profile_id: 'bp-glow-norte',
          scheduled_at: dateObj,
          duracion_minutos: 180,
          valor_bruto: 280000,
          comision_plataforma: 28000,
          impuestos_estado: 53200,
          estado: 'COMPLETADA',
          created_at: dateObj
        });

        // Crear transacción contable asociada
        await Transaction.create({
          booking_id: bNorte.id,
          amount: 280000,
          status: 'COMPLETADO',
          payment_method: 'WOMPI',
          external_id: `REF-GLOW-${year}-${month}-N`
        });

        bookingCount++;
      }
    }

    console.log(`🎉 ¡Siembra exitosa! Se registraron ${bookingCount} reservas y transacciones históricas distribuidas entre 2023 y 2026.`);
    console.log('\n======================================================');
    console.log('👤 CREDENCIALES DEL PROPIETARIO DEMO:');
    console.log('   Email: propietario@salonglow.com');
    console.log('   Password: REDACTED (definida por SEED_PASSWORD al sembrar)');
    console.log('🏢 SEDES HABILITADAS (3 AÑOS DE OPERACIÓN):');
    console.log('   1. GlowApp Salón & Spa Sede Norte (ID: bp-glow-norte)');
    console.log('   2. GlowApp Barbería & Estética Chapinero (ID: bp-glow-chapinero)');
    console.log('   3. GlowApp Centro de Estética Zona T (ID: bp-glow-zonat)');
    console.log('======================================================\n');

  } catch (error) {
    console.error('❌ Error en el script de siembra:', error);
  } finally {
    process.exit(0);
  }
}

seed3YearsData();
