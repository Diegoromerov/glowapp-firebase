/**
 * GLOWAPP BUSINESS DIAGNOSTIC SERVICE
 * Initial diagnosis engine handling New Business vs Existing Business entry doors.
 */

const businessRepository = require('../repositories/businessRepository');

class BusinessDiagnosticService {
  /**
   * Run initial diagnosis for a provider business.
   * Supports Door 1 (NEW_BUSINESS) and Door 2 (EXISTING_BUSINESS).
   */
  async runDiagnostic({ provider_id, tenant_id, name, onboarding_mode, vertical_code, city, answers }) {
    const vertical = await businessRepository.getVerticalByCode(vertical_code || 'BEAUTY_SALON');
    
    // Create or fetch profile
    let profile = await businessRepository.getProfileByProviderId(provider_id);
    if (!profile) {
      profile = await businessRepository.createProfile({
        provider_id,
        tenant_id,
        vertical_id: vertical.id,
        name: name || 'Mi Negocio de Belleza',
        onboarding_mode: onboarding_mode || 'NEW_BUSINESS',
        lifecycle_stage: onboarding_mode === 'EXISTING_BUSINESS' ? 'OPERATION' : 'IDEA',
        city: city || 'Bogotá'
      });
    }

    // Generate initial requirements & findings based on Door
    const requirements = await businessRepository.getRequirementsByVertical(vertical.id);
    const generatedTasks = [];
    const generatedFindings = [];

    if (onboarding_mode === 'EXISTING_BUSINESS') {
      // Door 2: Existing Business Audit
      generatedFindings.push({
        business_profile_id: profile.id,
        title: 'Auditoría de Protocolo de Bioseguridad RH1',
        description: 'Revisión periódica obligatoria de desinfección y plan de manejo de residuos.',
        risk_level: 'HIGH',
        mitigation_plan: 'Actualizar manual de bioseguridad e instruir al personal del local.'
      });

      generatedFindings.push({
        business_profile_id: profile.id,
        title: 'Formalización de Vinculación de Colaboradores',
        description: 'Verificación de contratos y afiliación a seguridad social.',
        risk_level: 'MEDIUM',
        mitigation_plan: 'Generar contratos borrador y verificar afiliación a ARL/EPS.'
      });

      for (const req of requirements) {
        generatedTasks.push({
          business_profile_id: profile.id,
          requirement_id: req.id,
          title: `Auditar: ${req.title}`,
          description: req.description,
          stage: 'ENTENDER',
          status: 'IN_PROGRESS',
          due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        });
      }

      await businessRepository.updateProfileStage(profile.id, 'AUDIT', 55.0);
    } else {
      // Door 1: New Business Guided Setup
      for (const req of requirements) {
        generatedTasks.push({
          business_profile_id: profile.id,
          requirement_id: req.id,
          title: `Trámite: ${req.title}`,
          description: req.description,
          stage: 'ENTENDER',
          status: 'PENDING',
          due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        });
      }

      await businessRepository.updateProfileStage(profile.id, 'CONSTITUTION', 15.0);
    }

    const tasks = await businessRepository.createTasks(generatedTasks);
    const findings = await businessRepository.createFindings(generatedFindings);

    return {
      profile: await businessRepository.getProfileByProviderId(provider_id),
      vertical,
      tasks,
      findings,
      summary: onboarding_mode === 'EXISTING_BUSINESS'
        ? 'Diagnóstico de auditoría completado. Se han generado 2 hallazgos y su plan de mejora continua.'
        : 'Diagnóstico de negocio nuevo completado. Se ha estructurado la ruta de trámites de apertura.'
    };
  }

  async getProfileSummary(provider_id, tenant_id) {
    const profile = await businessRepository.getProfileByProviderId(provider_id);
    if (!profile) return null;

    const tasks = await businessRepository.getTasksByProfileId(profile.id);
    const findings = await businessRepository.getFindingsByProfileId(profile.id);

    const completedTasks = tasks.filter(t => t.status === 'VERIFIED').length;
    const totalTasks = tasks.length || 1;
    const rawScore = Math.round((completedTasks / totalTasks) * 100);
    const updatedScore = Math.min(100, Math.max(0, Number.isNaN(rawScore) ? 0 : rawScore));

    await businessRepository.updateProfileStage(profile.id, profile.lifecycle_stage, updatedScore);

    return {
      profile: { ...profile, compliance_score: updatedScore },
      tasksCount: tasks.length,
      completedTasks,
      openFindings: findings.filter(f => f.status === 'OPEN').length,
      tasks,
      findings
    };
  }
}

module.exports = new BusinessDiagnosticService();
