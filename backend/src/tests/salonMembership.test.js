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
  getMembershipForSalonUser,
  canAdminSalon,
  ensureMembership,
} = require('../services/salonMembership');

function dbCon(filas) {
  const consultas = [];
  const db = {
    consultas,
    async query(sql, params) {
      consultas.push({ sql, params });
      if (sql.includes('FROM salones')) return { rows: [{ business_profile_id: 'bp-test' }] };
      if (sql.includes('set_config')) return { rows: [{ set_config: 'bp-test' }] };
      return { rows: typeof filas === 'function' ? filas(sql, params) : filas };
    },
  };
  db.connect = async () => ({
    query: db.query.bind(db),
    release: jest.fn(),
  });
  return db;
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

    const miembros = await listSalonMembers(db, 42, 7);

    expect(db.consultas.find(({ sql }) => sql.includes('FROM salones')).sql).toContain('FROM salones');
    const membershipsQuery = db.consultas.find(({ sql }) => sql.includes('FROM memberships'));
    expect(membershipsQuery.params[0]).toBe(42);
    expect(miembros).toHaveLength(2);
    expect(miembros[0].sub_rol).toBe('ADMINISTRADOR');
    // Sin etiqueta guardada, se deriva del rol en vez de devolver null.
    expect(miembros[1].sub_rol).toBe('EMPLEADO');
    expect(miembros[1].estatus).toBe('INACTIVO');
  });

  test('getMemberRole devuelve null si no hay membership activa', async () => {
    const emptyDb = dbCon((sql) => sql.includes('FROM salones') ? [{ business_profile_id: 'bp-1' }] : []);
    expect(await getMemberRole(emptyDb, 1, 2)).toBeNull();

    const db = dbCon((sql) => sql.includes('FROM salones') ? [{ business_profile_id: 'bp-1' }] : [{ role: 'MANAGER', sub_rol: null }]);
    const rol = await getMemberRole(db, 1, 2);
    expect(rol).toEqual({ role: 'MANAGER', sub_rol: 'RECEPCIONISTA' });
    expect(db.consultas.find(({ sql }) => sql.includes('FROM memberships')).sql).toContain("status = 'ACTIVE'");
  });

  test('resuelve el id y tenant de la membership activa para la ruta heredada del salón', async () => {
    const db = dbCon([{ id: 'm-5', business_profile_id: 'bp-5', user_id: 11, role: 'MEMBER', status: 'ACTIVE' }]);
    const membership = await getMembershipForSalonUser(db, 5, 11);

    expect(membership).toMatchObject({ id: 'm-5', business_profile_id: 'bp-5', user_id: 11 });
    expect(db.consultas[0].sql).toContain('JOIN salones s ON s.business_profile_id = m.business_profile_id');
    expect(db.consultas[0].sql).toContain("m.status = 'ACTIVE'");
  });

  test('sólo OWNER y ADMIN administran el equipo', async () => {
    const respuesta = (role) => async (sql) =>
      sql.includes('FROM salones') ? { rows: [{ business_profile_id: 'bp-1' }] } :
        sql.includes('FROM memberships') ? { rows: [{ role, sub_rol: null }] } : { rows: [] };

    const dbForRole = (role) => {
      const db = { query: respuesta(role) };
      db.connect = async () => ({ query: db.query.bind(db), release: jest.fn() });
      return db;
    };
    expect(await canAdminSalon(dbForRole('OWNER'), 1, 1)).toBe(true);
    expect(await canAdminSalon(dbForRole('ADMIN'), 1, 1)).toBe(true);
    expect(await canAdminSalon(dbForRole('MANAGER'), 1, 1)).toBe(false);
    expect(await canAdminSalon(dbForRole('MEMBER'), 1, 1)).toBe(false);
    expect(await canAdminSalon(dbForRole('VIEWER'), 1, 1)).toBe(false);
  });
});

describe('E-02b — escritura canónica', () => {
  test('ensureMembership resuelve el perfil explícito y guarda la etiqueta', async () => {
    const consultas = [];
    const db = {
      consultas,
      async query(sql, params) {
        consultas.push({ sql, params });
        if (sql.includes('FROM salones')) return { rows: [{ business_profile_id: 'bp-5' }] };
        return { rows: [{ id: 'm9', role: 'MANAGER', sub_rol: 'RECEPCIONISTA', status: 'ACTIVE' }] };
      },
    };
    db.connect = async () => ({ query: db.query.bind(db), release: jest.fn() });

    const res = await ensureMembership(db, { salonId: 5, userId: 11, subRol: 'RECEPCIONISTA' });

    expect(res.role).toBe('MANAGER');
    const { sql, params } = db.consultas.find(({ sql }) => sql.includes('INSERT INTO memberships'));
    expect(sql).toContain('INSERT INTO memberships');
    expect(sql).toMatch(/ON CONFLICT \(user_id, business_profile_id\) DO UPDATE/);
    expect(params[1]).toBe(11);
    expect(params[2]).toBe('bp-5');
    expect(params[3]).toBe('MANAGER');
    expect(params[4]).toBe('RECEPCIONISTA');
  });

  test('una baja se escribe como SUSPENDED, no como borrado', async () => {
    const consultas = [];
    const db = {
      consultas,
      async query(sql, params) {
        consultas.push({ sql, params });
        if (sql.includes('FROM salones')) return { rows: [{ business_profile_id: 'bp-5' }] };
        return { rows: [{ id: 'm9', role: 'MEMBER', sub_rol: 'EMPLEADO', status: 'SUSPENDED' }] };
      },
    };
    db.connect = async () => ({ query: db.query.bind(db), release: jest.fn() });

    await ensureMembership(db, { salonId: 5, userId: 11, subRol: 'EMPLEADO', status: 'SUSPENDED' });

    expect(db.consultas.find(({ sql }) => sql.includes('INSERT INTO memberships')).params[5]).toBe('SUSPENDED');
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

  test('el acceso a membresías resuelve el perfil desde la relación explícita de la sede', async () => {
    const db = dbCon([{ id: 'm1', role: 'OWNER', sub_rol: 'DUEÑO' }]);
    await getMemberRole(db, 10, 2);
    const membershipQuery = db.consultas.find(({ sql }) => sql.includes('FROM memberships'));
    expect(membershipQuery.sql).toContain('JOIN salones s ON s.business_profile_id = m.business_profile_id');
    expect(membershipQuery.params[0]).toBe(10);
  });
});
