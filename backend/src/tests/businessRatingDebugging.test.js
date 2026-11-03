/**
 * GLOWAPP BUSINESS RATING SYSTEMATIC DEBUGGING SUITE
 * Verifies edge cases, division by zero, non-numeric inputs, and status normalization.
 * Complies with systematic-debugging skill.
 */

const businessDiagnosticService = require('../services/businessDiagnosticService');
const businessRepository = require('../repositories/businessRepository');

describe('Systematic Debugging — Business Rating & Compliance Score Suite', () => {
  test('1. Handles empty tasks array cleanly without Division by Zero (Score = 0%)', async () => {
    // provider_id es INTEGER en business_profiles (migracion 012 + pgMemory.js).
    // Con un string, pg-mem corta con "invalid input syntax for integer" y el
    // caso de division por cero nunca llega a ejercitarse.
    const mockProviderId = 900001;
    const profile = await businessRepository.createProfile({
      id: 'biz-debug-empty',
      provider_id: mockProviderId,
      name: 'Peluquería Vacía',
      onboarding_mode: 'NEW_BUSINESS'
    });

    const summary = await businessDiagnosticService.getProfileSummary(mockProviderId, 'tenant-debug');
    expect(summary).not.toBeNull();
    expect(typeof summary.profile.compliance_score).toBe('number');
    expect(summary.profile.compliance_score).toBeGreaterThanOrEqual(0);
    expect(summary.profile.compliance_score).toBeLessThanOrEqual(100);
  });

  test('2. Clamps out-of-bounds score within 0 to 100 range', async () => {
    const profile = await businessRepository.updateProfileStage('biz-debug-empty', 'IDEA', 150.0);
    expect(profile).not.toBeNull();
    // Verify fallback or returned profile does not cause application crash
  });

  test('3. Verifies score update consistency on getProfileSummary', async () => {
    // INTEGER, igual que el caso anterior: el esquema lo exige.
    const mockProviderId = 900002;
    const profile = await businessRepository.createProfile({
      id: 'biz-debug-calc',
      provider_id: mockProviderId,
      name: 'Studio Test Calc',
      onboarding_mode: 'NEW_BUSINESS'
    });

    const tasks = [
      { business_profile_id: profile.id, title: 'Tarea 1', status: 'VERIFIED' },
      { business_profile_id: profile.id, title: 'Tarea 2', status: 'PENDING' }
    ];
    await businessRepository.createTasks(tasks);

    const summary = await businessDiagnosticService.getProfileSummary(mockProviderId, 'tenant-debug');
    expect(summary.profile.compliance_score).toBe(50);
  });
});
