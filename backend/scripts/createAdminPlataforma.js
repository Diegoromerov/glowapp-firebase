/**
 * SCRIPT IDEMPOTENTE DE CREACIÓN DE USUARIO ADMINISTRADOR DE PLATAFORMA (GLOWSHOP B-01)
 * 
 * Requisitos:
 *  - Lee ADMIN_EMAIL y ADMIN_PASSWORD de variables de entorno.
 *  - Si faltan, aborta con error explicativo (cero contraseñas por defecto o en texto plano).
 *  - Hashea con bcryptjs a 10 rondas (mismo estándar que authController.js).
 *  - Asigna rol 'ADMIN' y el tenant_id de la plataforma resolviéndolo mediante consulta SQL.
 *  - Idempotente: si el usuario ya existe, actualiza su hash de contraseña y asegura rol y tenant.
 *  - Autoverificación: confirma en la BD que la cantidad de usuarios ADMIN es >= 1.
 */

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://admin:admin123@localhost:5435/beauty_db'
});

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('❌ ERROR: Debe proporcionar las variables de entorno ADMIN_EMAIL y ADMIN_PASSWORD.');
    console.error('   Ejemplo de uso: ADMIN_EMAIL="admin@beautyapp.com" ADMIN_PASSWORD="TU_PASSWORD" node scripts/createAdminPlataforma.js');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('❌ ERROR: La contraseña del usuario administrador debe tener al menos 8 caracteres.');
    process.exit(1);
  }

  try {
    console.log('🔍 Resolviendo contexto del tenant de la plataforma...');
    const platRes = await pool.query('SELECT app_platform_tenant_id() AS tid');
    let platformTenantId = platRes.rows[0]?.tid;

    if (!platformTenantId) {
      const fallbackRes = await pool.query('SELECT id FROM tenants ORDER BY id LIMIT 1');
      platformTenantId = fallbackRes.rows[0]?.id || 1;
    }

    console.log(`   Tenant de plataforma resuelto: ID ${platformTenantId}`);

    console.log('🔒 Generando hash de contraseña seguro (bcrypt 10 rondas)...');
    const passwordHash = await bcrypt.hash(password, 10);

    const checkRes = await pool.query('SELECT id, email, rol FROM usuarios WHERE email = $1', [email.trim().toLowerCase()]);

    if (checkRes.rows.length > 0) {
      const existingUser = checkRes.rows[0];
      console.log(`👤 Usuario existente encontrado (ID: ${existingUser.id}). Actualizando a rol ADMIN y nuevo hash...`);
      
      await pool.query(`
        UPDATE usuarios 
        SET password_hash = $1, rol = 'ADMIN', tenant_id = $2, is_active = true
        WHERE id = $3
      `, [passwordHash, platformTenantId, existingUser.id]);
    } else {
      console.log(`➕ Creando nuevo usuario administrador de plataforma: ${email}...`);
      await pool.query(`
        INSERT INTO usuarios (email, nombre, auth_provider, provider_id, password_hash, rol, tenant_id, is_active, onboarding_completo)
        VALUES ($1, 'Administrador de Plataforma', 'LOCAL', $1, $2, 'ADMIN', $3, true, true)
      `, [email.trim().toLowerCase(), passwordHash, platformTenantId]);
    }

    // Autoverificación asertiva
    const countRes = await pool.query("SELECT COUNT(*) FROM usuarios WHERE rol = 'ADMIN'");
    const adminCount = parseInt(countRes.rows[0].count, 10);

    console.log(`📊 Conteo total de usuarios ADMIN en la BD: ${adminCount}`);

    if (adminCount < 1) {
      throw new Error('La autoverificación falló: No se encontraron usuarios con rol ADMIN en la BD.');
    }

    console.log('✅ Usuario ADMIN de plataforma configurado exitosamente (idempotente).');
  } catch (err) {
    console.error('❌ Error ejecutando createAdminPlataforma.js:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
