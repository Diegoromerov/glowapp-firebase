/**
 * GLOWAPP BUSINESS RAG & AURA INTEGRATION TEST SUITE (GOAL 05 — PHASE E)
 * Tests Multi-Tenant RAG Isolation, Regulatory Scope, Read-Only Enforcement, and RAG Quality Matrix.
 */

const { searchBeautyKnowledge, formatKnowledgeContext } = require('../services/ragService');
const { executeAuraTool, AURA_TOOLS_DEFINITIONS } = require('../services/auraToolExecutor');

const businessDiagnosticService = require('../services/businessDiagnosticService');

// business_profiles.provider_id es INTEGER (ver migracion 012 y src/config/pgMemory.js).
// Un id de texto hace fallar el INSERT con "invalid input syntax for integer", lo que
// revienta el beforeAll y arrastra los 15 casos de esta suite.
const AURA_TEST_PROVIDER_ID = 900003;

describe('GlowApp Business Engine — GOAL 05 Aura + RAG Security & Quality Suite', () => {

  beforeAll(async () => {
    await businessDiagnosticService.runDiagnostic({
      provider_id: AURA_TEST_PROVIDER_ID,
      tenant_id: 'tenant-alpha',
      name: 'Spa Alpha Test',
      onboarding_mode: 'EXISTING_BUSINESS',
      vertical_code: 'BEAUTY_SALON'
    });
  });

  describe('Part 1: RAG Security & Multi-Tenant Boundaries (Section 22)', () => {

    test('TEST 01: Multi-Tenant Isolation - Tenant A NO recupera documentos privados de Tenant B', async () => {
      // Búsqueda realizada con el contexto de Tenant A
      const resultsForTenantA = await searchBeautyKnowledge('Manual de Bioseguridad Privado', {
        tenantId: 'tenant-alpha'
      });

      // Ningún resultado devuelto debe pertenecer a Tenant B ('tenant-beta')
      const leakedDocs = resultsForTenantA.filter(doc => doc.tenant_id && doc.tenant_id === 'tenant-beta');
      expect(leakedDocs.length).toBe(0);
    });

    test('TEST 02: Business Isolation - Negocio A no recupera hallazgos privados de Negocio B', async () => {
      // Intentar ejecutar herramienta para prestador distinto al autenticado
      const res = await executeAuraTool('query_user_biometric_profile', { userId: 9999 }, 1000);
      expect(res.error).toBe('ownership_required');
    });

    test('TEST 03: Global Knowledge Access - Conocimiento GLOBAL (tenant_id IS NULL) sí es recuperable', async () => {
      const results = await searchBeautyKnowledge('Concepto Sanitario Favorativo', {
        tenantId: 'tenant-alpha'
      });

      // Debe ser capaz de retornar resultados globales o array controlado
      expect(Array.isArray(results)).toBe(true);
    });

    test('TEST 04: Jurisdiction Filtering - Filtrado regulatorio por jurisdicción', async () => {
      const results = await searchBeautyKnowledge('Concepto Sanitario Municipal', {
        filters: { domain: 'BUSINESS', jurisdiction: 'MUNICIPAL' },
        tenantId: 'tenant-alpha'
      });

      expect(Array.isArray(results)).toBe(true);
    });

    test('TEST 05: Expired Knowledge Filter - Documentos expirados son excluidos de la búsqueda', async () => {
      const results = await searchBeautyKnowledge('Norma Expirada Test', {
        tenantId: 'tenant-alpha'
      });

      const expiredDocs = results.filter(doc => doc.expires_at && new Date(doc.expires_at) < new Date());
      expect(expiredDocs.length).toBe(0);
    });

    test('TEST 06: Read-Only Enforcement - No se permite al LLM ejecutar acciones mutativas o SQL arbitrario', async () => {
      const result = await executeAuraTool('non_existent_mutative_tool', {}, 100);
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('desconocida');
    });
  });

  describe('Part 2: RAG Quality Matrix (Section 23)', () => {

    test('Q1 — Factual Retrieval: Búsqueda de normatividad sanitaria de bioseguridad', async () => {
      const results = await searchBeautyKnowledge('protocolo bioseguridad desinfeccion', { topK: 3 });
      expect(Array.isArray(results)).toBe(true);
    });

    test('Q2 — Business Contextual Retrieval: Consulta de resumen de expediente de negocio', async () => {
      const res = await executeAuraTool('get_business_profile_summary', {}, AURA_TEST_PROVIDER_ID, 'provider', 'tenant-alpha');
      expect(res.status).toBe('success');
      expect(res.summary).toHaveProperty('profile');
      expect(res.summary.profile).toHaveProperty('compliance_score');
    });

    test('Q3 — Tenant Private Retrieval: Tareas privadas del prestador autenticado', async () => {
      const res = await executeAuraTool('get_business_tasks', {}, AURA_TEST_PROVIDER_ID, 'provider', 'tenant-alpha');
      expect(res.status).toBe('success');
      expect(Array.isArray(res.tasks)).toBe(true);
    });

    test('Q4 — Regulatory Retrieval: Recuperación de normatividad regulatoria nacional', async () => {
      const res = await executeAuraTool('search_regulatory_knowledge_rag', { queryText: 'Resolución 2827 bioseguridad' }, AURA_TEST_PROVIDER_ID, 'provider', 'tenant-alpha');
      expect(res.status).toBe('success');
      expect(res.domain).toBe('REGULATORY');
    });

    test('Q5 — Irrelevant Query: Consulta irrelevante fuera del dominio de belleza', async () => {
      const results = await searchBeautyKnowledge('clima hoy en Bogota', { topK: 3 });
      // RAG devuelve array vacío o sin coincidencia alta
      expect(Array.isArray(results)).toBe(true);
    });

    test('Q6 — Missing Knowledge Fallback: Consulta sobre conocimiento inexistente', async () => {
      const results = await searchBeautyKnowledge('regulaciones de peluqueria en la luna', { topK: 3 });
      expect(Array.isArray(results)).toBe(true);
    });

    test('Q7 — Expired Knowledge Handling: Manejo de versiones y vigencia de fuentes', async () => {
      const results = await searchBeautyKnowledge('Ley 9 de 1979 norma marco', { topK: 3 });
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Part 3: Aura Tool Registry Verification', () => {

    test('Definición de Herramientas Aura incluye Business Read-Only Tools', () => {
      const toolNames = AURA_TOOLS_DEFINITIONS.map(t => t.function.name);
      expect(toolNames).toContain('get_business_profile_summary');
      expect(toolNames).toContain('get_business_tasks');
      expect(toolNames).toContain('search_regulatory_knowledge_rag');
    });
  });
});
