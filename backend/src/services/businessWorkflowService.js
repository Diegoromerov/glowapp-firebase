/**
 * GLOWAPP BUSINESS WORKFLOW SERVICE
 * Task lifecycle state machine: ENTENDER -> EXPLICAR -> RECOMENDAR -> EJECUTAR -> VERIFICAR
 */

const businessRepository = require('../repositories/businessRepository');

const STAGE_ORDER = ['ENTENDER', 'EXPLICAR', 'RECOMENDAR', 'EJECUTAR', 'VERIFICAR'];

class BusinessWorkflowService {
  async getTasksForProvider(providerId, tenantId) {
    const profile = await businessRepository.getProfileByProviderId(providerId);
    if (!profile) return [];
    const tasks = await businessRepository.getTasksByProfileId(profile.id);
    return tasks.map(t => ({
      ...t,
      provider_id: t.provider_id || profile.provider_id,
      tenant_id: t.tenant_id || profile.tenant_id
    }));
  }

  async advanceTaskStage({ taskId, providerId, tenantId, action, notes }) {
    // Ownership check (IDOR Protection)
    const task = await businessRepository.getTaskByIdAndProvider(taskId, providerId);
    if (!task) {
      return null; // Unauthorized or not found
    }

    const currentIndex = STAGE_ORDER.indexOf(task.stage);
    let nextStage = task.stage;
    let nextStatus = task.status;

    if (action === 'NEXT' && currentIndex < STAGE_ORDER.length - 1) {
      nextStage = STAGE_ORDER[currentIndex + 1];
    } else if (action === 'SUBMIT_EVIDENCE') {
      nextStage = 'VERIFICAR';
      nextStatus = 'SUBMITTED';
    } else if (action === 'VERIFY') {
      nextStage = 'VERIFICAR';
      nextStatus = 'VERIFIED';
    }

    const updated = await businessRepository.updateTaskStage(taskId, nextStage, nextStatus);

    return {
      task: updated,
      stage: nextStage,
      status: nextStatus,
      message: `Tarea avanzada a la etapa: ${nextStage}`
    };
  }

  async submitEvidence({ taskId, providerId, tenantId, filePath, evidenceType, notes }) {
    // Ownership check (IDOR Protection)
    const task = await businessRepository.getTaskByIdAndProvider(taskId, providerId);
    if (!task) {
      return null; // Unauthorized or not found
    }

    const evidence = await businessRepository.addEvidence({
      task_id: taskId,
      file_path: filePath,
      evidence_type: evidenceType || 'DOCUMENT',
      validation_state: 'EVIDENCE_SUBMITTED',
      reviewer_notes: notes || 'Evidencia subida correctamente por el usuario.'
    });

    await businessRepository.updateTaskStage(taskId, 'VERIFICAR', 'SUBMITTED');

    return {
      evidence,
      validation_state: 'EVIDENCE_SUBMITTED',
      message: 'Evidencia registrada y enviada a cola de verificación.'
    };
  }

  async getAdminEvidenceQueue() {
    return businessRepository.getAdminEvidenceQueue();
  }

  async reviewEvidenceAdmin({ evidenceId, action, notes, adminId }) {
    const isApproved = action === 'APPROVED';
    const validationState = isApproved ? 'EVIDENCE_VALIDATED' : 'USER_DECLARED';
    const reviewerNotes = notes || (isApproved ? 'Evidencia aprobada por administrador.' : 'Evidencia rechazada por observaciones.');

    const updatedEvidence = await businessRepository.updateEvidenceStatus(evidenceId, validationState, reviewerNotes);
    if (!updatedEvidence) {
      throw new Error('Evidencia no encontrada');
    }

    // Update corresponding task state
    const taskStatus = isApproved ? 'VERIFIED' : 'IN_PROGRESS';
    await businessRepository.updateTaskStage(updatedEvidence.task_id, 'VERIFICAR', taskStatus);

    return {
      evidence: updatedEvidence,
      validationState,
      taskStatus,
      reviewedBy: adminId,
      message: `Evidencia ${isApproved ? 'aprobada' : 'rechazada'} exitosamente.`
    };
  }
}

module.exports = new BusinessWorkflowService();
