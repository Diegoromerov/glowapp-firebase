'use strict';

/**
 * E-02b (D-GL-027) — los miembros del salón se leen de `memberships`.
 *
 * Lo que se fija aquí:
 *  1. la traducción entre los dos vocabularios de rol (el bug silencioso: si
 *     RECEPCIONISTA no mapea a MANAGER, el guard y la UI discrepan);
 *  2. que el listado derive la etiqueta cuando la fila vieja no la trae;
 *  3. que `canAdminSalon` no deje administrar a un MEMBER;
 *  4. que ningún controlador vuelva a leer `salon_miembros` (el criterio de
 *     T-121, escrito como prueba para que no se pierda en el próximo refactor).
 */

const fs = require('fs');
const path = require('path');

const {
  roleForSubRol,
  subRolForRole,
  listSalonMembers,
  getMemberRole,
  canAdminSalon,
  ensureMembership,
  profileIdForSalon,
} = require('../services/salonMembership');

function dbCon(filas) {
  const consultas = [];
  return {
    consultas,
    async query(sql, params) {
      consultas.push({ sql, params });
      return { rows: typeof filas === 'function' ? filas(sql, params) : filas };
    },
  };
}

describe('E-02b — mapeo de roles entre memberships y salon_miembros', () => {
  test('sub_rol heredado → rol canónico', () => {
    expect(roleForSubRol('DUEÑO')).toBe('OWNER');
    expect(roleForSubRol('dueno')).toBe('OWNER');
    expect(roleForSubRol('ADMINISTRADOR')).toBe('ADMIN');
    expect(roleForSubRol('RECEPCIONISTA')).toBe('MANAGER');
    expect(roleForSubRol('PRESTADOR_INDEPENDIENTE')).toBe('MEMBER');
    expect(roleForSubRol('EMPLEADO')).toBe('MEMBER');
    // Un texto libre desconocido no puede escalar privilegios.
    expect(roleForSubRol('SUPER_ADMIN')).toBe('MEMBER');
    expect(roleForSubRol(null)).toBe('MEMBER');
  });

  test('rol canónico → etiqueta por defecto', () => {
    expect(subRolForRole('OWNER')).toBe('DUEÑO');
    expect(subRolForRole('ADMIN')).toBe('ADMINISTRADOR');
    expect(subRolForRole('MANAGER')).toBe('RECEPCIONISTA');
    expect(subRolForRole('MEMBER')).toBe('EMPLEADO');
  });
});

describe('E-02b — lectura del equipo', () => {
  test('lista los miembros del perfil del salón y traduce estatus', async () => {
    const db = dbCon([
      { id: 'm1', user_id: 7, nombre: 'Ana', email: 'a@x.co', phone: null, sub_rol: 'ADMINISTRADOR', role: 'ADMIN', estatus: 'ACTIVO', creado_at: new Date() },
      { id: 'm2', user_id: 8, nombre: 'Luis', email: 'l@x.co', phone: null, sub_rol: null, role: 'MEMBER', estatus: 'INACTIVO', creado_at: new Date() },
    ]);

    const miembros = await listSalonMembers(db, 42);

    expect(db.consultas[0].params[0]).toBe('salon-42');
    expect(db.consultas[0].sql).toContain('FROM memberships');
    expect(miembros).toHaveLength(2);
    expect(miembros[0].sub_rol).toBe('ADMINISTRADOR');
    // Sin etiqueta guardada, se deriva del rol en vez de devolver null.
    expect(miembros[1].sub_rol).toBe('EMPLEADO');
    expect(miembros[1].estatus).toBe('INACTIVO');
  });

  test('getMemberRole devuelve null si no hay membership activa', async () => {
    expect(await getMemberRole(dbCon([]), 1, 2)).toBeNull();

    const db = dbCon([{ role: 'MANAGER', sub_rol: null }]);
    const rol = await getMemberRole(db, 1, 2);
    expect(rol).toEqual({ role: 'MANAGER', sub_rol: 'RECEPCIONISTA' });
    expect(db.consultas[0].sql).toContain("status = 'ACTIVE'");
  });

  test('sólo OWNER y ADMIN administran el equipo', async () => {
    const respuesta = (role) => async (sql) =>
      sql.includes('FROM memberships') ? { rows: [{ role, sub_rol: null }] } : { rows: [] };

    expect(await canAdminSalon({ query: respuesta('OWNER') }, 1, 1)).toBe(true);
    expect(await canAdminSalon({ query: respuesta('ADMIN') }, 1, 1)).toBe(true);
    expect(await canAdminSalon({ query: respuesta('MANAGER') }, 1, 1)).toBe(false);
    expect(await canAdminSalon({ query: respuesta('MEMBER') }, 1, 1)).toBe(false);
    expect(await canAdminSalon({ query: respuesta('VIEWER') }, 1, 1)).toBe(false);
  });
});

describe('E-02b — escritura canónica', () => {
  test('ensureMembership hace upsert idempotente y guarda la etiqueta', async () => {
    const db = dbCon([{ id: 'm9', role: 'MANAGER', sub_rol: 'RECEPCIONISTA', status: 'ACTIVE' }]);

    const res = await ensureMembership(db, { salonId: 5, userId: 11, subRol: 'RECEPCIONISTA' });

    expect(res.role).toBe('MANAGER');
    const { sql, params } = db.consultas[0];
    expect(sql).toContain('INSERT INTO memberships');
    expect(sql).toMatch(/ON CONFLICT \(user_id, business_profile_id\) DO UPDATE/);
    expect(params[1]).toBe(11);
    expect(params[2]).toBe('salon-5');
    expect(params[3]).toBe('MANAGER');
    expect(params[4]).toBe('RECEPCIONISTA');
  });

  test('una baja se escribe como SUSPENDED, no como borrado', async () => {
    const db = dbCon([{ id: 'm9', role: 'MEMBER', sub_rol: 'EMPLEADO', status: 'SUSPENDED' }]);

    await ensureMembership(db, { salonId: 5, userId: 11, subRol: 'EMPLEADO', status: 'SUSPENDED' });

    expect(db.consultas[0].params[5]).toBe('SUSPENDED');
  });
});

describe('E-02b — compuerta: los controladores no vuelven a leer salon_miembros', () => {
  test('salonController no tiene SELECT sobre la tabla heredada', () => {
    const fuente = fs.readFileSync(
      path.join(__dirname, '..', 'controllers', 'salonController.js'),
      'utf8'
    );

    // Las escrituras (INSERT/UPDATE) se conservan para no romper ownerGuard; lo
    // que no puede volver es una LECTURA de la tabla heredada.
    const lecturas = fuente.match(/FROM\s+salon_miembros|JOIN\s+salon_miembros/gi) || [];
    expect(lecturas).toHaveLength(0);
  });

  test('el perfil del salón usa la convención que comparten bootstrap, identidad y migraciones', () => {
    expect(profileIdForSalon(10)).toBe('salon-10');
  });
});
