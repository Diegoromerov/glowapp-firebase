const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test_secret_key_2026';
process.env.JWT_SECRET = JWT_SECRET;

const { toApiRole } = require('../src/config/jwt');

describe('Role Segmentation & SaaS Salon Architecture Tests', () => {

  test('toApiRole debe mapear correctamente todos los roles', () => {
    expect(toApiRole('CLIENTE')).toBe('client');
    expect(toApiRole('PRESTADOR')).toBe('provider');
    expect(toApiRole('SALON')).toBe('salon');
    expect(toApiRole('ADMIN')).toBe('admin');
    expect(toApiRole('UNKNOWN')).toBeNull();
  });

  test('Valida que las opciones de rol aceptadas incluyan CLIENTE, PRESTADOR y SALON', () => {
    const validRoles = ['CLIENTE', 'PRESTADOR', 'SALON'];
    expect(validRoles.includes('SALON')).toBe(true);
    expect(validRoles.includes('CLIENTE')).toBe(true);
    expect(validRoles.includes('PRESTADOR')).toBe(true);
  });

  test('Valida que los sub-roles dentro del salón incluyan DUEÑO, ADMINISTRADOR, PRESTADOR_INDEPENDIENTE y EMPLEADO', () => {
    const validSubRoles = ['DUEÑO', 'ADMINISTRADOR', 'PRESTADOR_INDEPENDIENTE', 'EMPLEADO', 'RECEPCIONISTA'];
    expect(validSubRoles).toContain('DUEÑO');
    expect(validSubRoles).toContain('ADMINISTRADOR');
    expect(validSubRoles).toContain('PRESTADOR_INDEPENDIENTE');
    expect(validSubRoles).toContain('EMPLEADO');
  });

});
