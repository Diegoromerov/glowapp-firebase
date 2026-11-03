const adminModel = require('./admin.model');
const financialHelper = require('./financial.helper');
const { CertifiedKYCProvider } = require('./CertifiedKYCProvider');

const kycProvider = new CertifiedKYCProvider();

/**
 * Obtener todas las alertas SOS en estado 'ACTIVO'.
 */
// Estados aceptados por el listado de alertas.
const ESTADOS_SOS = new Set(['ACTIVO', 'RESUELTO', 'TODOS']);

async function getAllActiveAlerts(req, res) {
  try {
    // ?estado=ACTIVO (por defecto: es lo que usa el contador del dashboard),
    // RESUELTO o TODOS (lo que usa /admin/sos para poder mostrar la resolución).
    const pedido = String(req.query?.estado || 'ACTIVO').toUpperCase();
    const estado = ESTADOS_SOS.has(pedido) ? pedido : 'ACTIVO';

    const alerts = await adminModel.getActiveSOSAlerts(estado);
    
    return res.status(200).json({
      success: true,
      count: alerts.length,
      data: alerts
    });
  } catch (error) {
    console.error('Error al obtener alertas SOS activas:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno al obtener las alertas de pánico activas.'
    });
  }
}

/**
 * Resolver una alerta SOS marcándola como 'ATENDIDA' y registrando la acción del operador.
 */
async function resolveSOSAlert(req, res) {
  try {
    const { id } = req.params;
    const adminId = req.admin.id; // Obtenido del middleware authAdmin
    const resolucion = String(req.body?.resolucion || '').trim();

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'El identificador (ID) de la alerta es requerido.'
      });
    }

    if (resolucion.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Describe la resolución de la alerta (mínimo 3 caracteres).'
      });
    }

    // 1. Actualizar el estado en sos_alerts.
    //    OJO: el CHECK de la tabla solo admite 'ACTIVO' y 'RESUELTO' (index.js, DDL
    //    de sos_alerts). Aquí se escribía 'ATENDIDO', que Postgres rechazaba con
    //    violación de constraint: el UPDATE fallaba siempre y la alerta nunca se
    //    atendía. Ver test de regresión del estado permitido.
    const actualizadas = await adminModel.updateSOSAlertStatus(id, 'RESUELTO', resolucion, adminId);

    if (!actualizadas || actualizadas.length === 0) {
      return res.status(404).json({
        success: false,
        error: `La alerta #${id} no existe o ya estaba atendida.`
      });
    }

    // 2. Registrar la acción en la bitácora admin_actions
    await adminModel.logAdminAction(
      adminId,
      'RESOLVER_SOS',
      `Alerta SOS ID ${id} atendida. Resolución: ${resolucion}`
    );

    return res.status(200).json({
      success: true,
      message: `Alerta SOS #${id} atendida.`,
      data: {
        id: Number(id),
        estado: 'RESUELTO',
        resolucion
      }
    });
  } catch (error) {
    console.error('Error al resolver alerta SOS:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno al marcar la alerta como atendida.'
    });
  }
}

/**
 * Activar la verificación del perfil de un prestador para habilitar su etiqueta verde.
 */
async function verifyProvider(req, res) {
  try {
    const { providerId } = req.body;
    const adminId = req.admin.id;

    if (!providerId) {
      return res.status(400).json({
        success: false,
        error: 'El ID del prestador es obligatorio para realizar la verificación.'
      });
    }

    // 1. Actualizar estado a 'VERIFICADO' en perfiles_prestador
    await adminModel.setProviderVerifiedStatus(providerId, true);

    // 2. Registrar auditoría de la acción
    await adminModel.logAdminAction(
      adminId,
      'VERIFICAR_PRESTADOR',
      `Prestador ID ${providerId} marcado como VERIFICADO`
    );

    return res.status(200).json({
      success: true,
      message: `El prestador #${providerId} ha sido verificado con éxito.`
    });
  } catch (error) {
    console.error('Error al verificar prestador:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno al actualizar la verificación del prestador.'
    });
  }
}

/**
 * Aprueba una solicitud de retiro (Payout) si cumple con el saldo disponible y no hay disputas activas.
 */
async function approvePayout(req, res) {
  try {
    const { providerId, amount } = req.body;
    const adminId = req.admin.id;

    if (!providerId || !amount || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'El ID del prestador y un monto de retiro válido son obligatorios.'
      });
    }

    const withdrawAmount = parseFloat(amount);

    // 1. Validar disputas activas relacionadas con el prestador
    const hasDisputes = await adminModel.hasActiveDisputes(providerId);
    if (hasDisputes) {
      return res.status(400).json({
        success: false,
        error: 'Retiro retenido. El prestador posee disputas activas pendientes de resolución.'
      });
    }

    // 2. Validar que el saldo de la billetera sea suficiente
    const availableBalance = await adminModel.getProviderWalletBalance(providerId);
    if (availableBalance < withdrawAmount) {
      return res.status(400).json({
        success: false,
        error: `Saldo insuficiente. Saldo disponible actual: $${availableBalance}`
      });
    }

    // 3. Procesar el retiro debitando el saldo
    const newBalance = availableBalance - withdrawAmount;
    await adminModel.processWalletWithdrawal(providerId, withdrawAmount, newBalance);

    // 4. Registrar logs administrativos
    await adminModel.logAdminAction(
      adminId,
      'APROBAR_RETIRO',
      `Aprobado retiro de $${withdrawAmount} para prestador ID ${providerId}. Nuevo saldo: $${newBalance}`
    );

    return res.status(200).json({
      success: true,
      message: 'Retiro aprobado con éxito. Los fondos serán liberados en una ventana de 24 a 48 horas.',
      data: {
        providerId,
        montoRetirado: withdrawAmount,
        saldoRestante: newBalance,
        tiempoLiberacionEstimado: '24-48 horas'
      }
    });
  } catch (error) {
    console.error('Error al aprobar retiro de fondos:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno al procesar y aprobar el retiro del prestador.'
    });
  }
}

/**
 * Obtener todos los prestadores pendientes de verificación.
 */
async function getPendingProvidersList(req, res) {
  try {
    const list = await adminModel.getPendingProviders();
    return res.status(200).json({
      success: true,
      count: list.length,
      data: list
    });
  } catch (error) {
    console.error('Error al obtener prestadores pendientes:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno al obtener los prestadores pendientes.'
    });
  }
}

/**
 * Aprobar la verificación del perfil de un prestador.
 */
async function approveProvider(req, res) {
  try {
    const { providerId } = req.body;
    const adminId = req.admin.id;

    if (!providerId) {
      return res.status(400).json({
        success: false,
        error: 'El ID del prestador es obligatorio para realizar la aprobación.'
      });
    }

    await adminModel.setProviderVerifiedStatus(providerId, true);
    await adminModel.logAdminAction(
      adminId,
      'APROBAR_PRESTADOR',
      `Prestador ID ${providerId} verificado y APROBADO`
    );

    return res.status(200).json({
      success: true,
      message: `El prestador #${providerId} ha sido aprobado exitosamente.`
    });
  } catch (error) {
    console.error('Error al aprobar prestador:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno al aprobar prestador.'
    });
  }
}

/**
 * Rechazar la verificación del perfil de un prestador.
 */
async function rejectProvider(req, res) {
  try {
    const { providerId } = req.body;
    const adminId = req.admin.id;

    if (!providerId) {
      return res.status(400).json({
        success: false,
        error: 'El ID del prestador es obligatorio para realizar el rechazo.'
      });
    }

    await adminModel.setProviderVerifiedStatus(providerId, false);
    await adminModel.logAdminAction(
      adminId,
      'RECHAZAR_PRESTADOR',
      `Prestador ID ${providerId} RECHAZADO`
    );

    return res.status(200).json({
      success: true,
      message: `El prestador #${providerId} ha sido rechazado.`
    });
  } catch (error) {
    console.error('Error al rechazar prestador:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno al rechazar prestador.'
    });
  }
}

/**
 * Automatización de KYC con Proveedor Certificado (DataCrédito/Experian/MidData).
 * Requiere contrato vigente y KYC_API_KEY configurada.
 * Registra evidencia inmutable en kyc_audit_logs para cumplimiento legal.
 */
async function verifyProviderAuto(req, res) {
  try {
    const { providerId, documentType, documentNumber } = req.body;
    const adminId = req.admin ? req.admin.id : null;

    // Si no hay sesión de administrador, validar token del webhook (SEC-05)
    if (!adminId) {
      const webhookToken = req.headers['x-webhook-token'];
      const expectedToken = process.env.KYC_WEBHOOK_SECRET;
      
      if (!webhookToken || webhookToken !== expectedToken) {
        return res.status(401).json({
          success: false,
          error: 'No autorizado. Se requiere un token de webhook válido para la verificación automatizada.'
        });
      }
    }

    if (!providerId) {
      return res.status(400).json({
        success: false,
        error: 'El ID del prestador es obligatorio para la verificación KYC.'
      });
    }

    if (!documentType || !documentNumber) {
      return res.status(400).json({
        success: false,
        error: 'Tipo y número de documento son obligatorios para la verificación KYC certificada.'
      });
    }

    // Validar documento con proveedor certificado (DataCrédito/Experian/MidData)
    let kycResult;
    try {
      kycResult = await kycProvider.verifyDocument(documentType, documentNumber, providerId);
    } catch (kycError) {
      // Error de configuración del proveedor (sin contrato, sin API key)
      if (kycError.message.includes('KYC_PROVIDER_NOT_CONFIGURED')) {
        console.error('[KYC] Proveedor certificado no configurado:', kycError.message);
        return res.status(503).json({
          success: false,
          error: 'Servicio KYC no disponible. Requiere contrato con proveedor certificado (DataCrédito/Experian/MidData).',
          details: 'KYC_PROVIDER_NOT_CONFIGURED'
        });
      }
      throw kycError;
    }

    // 1. Actualizar estado del prestador según resultado KYC real
    const isVerified = kycResult.valid;
    await adminModel.setProviderVerifiedStatus(providerId, isVerified);

    // 2. Registrar auditoría administrativa
    if (adminId) {
      await adminModel.logAdminAction(
        adminId,
        'KYC_AUTO_VERIFICACION',
        `Prestador ID ${providerId} verificado por ${kycProvider.providerName.toUpperCase()}: ${isVerified ? 'APROBADO' : 'RECHAZADO'} (Audit: ${kycResult.auditId})`
      );
    }

    return res.status(200).json({
      success: true,
      message: `El prestador #${providerId} ha sido ${isVerified ? 'verificado' : 'rechazado'} mediante KYC certificado (${kycProvider.providerName.toUpperCase()}).`,
      data: {
        providerId,
        verified: isVerified,
        provider: kycProvider.providerName,
        auditId: kycResult.auditId,
        verifiedAt: kycResult.providerResponse.verifiedAt
      }
    });
  } catch (error) {
    console.error('Error al realizar auto-verificación KYC:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno al procesar auto-verificación KYC.'
    });
  }
}

/**
 * Obtiene el resumen financiero consolidado para el panel de administración.
 */
async function getFinancialSummary(req, res) {
  try {
    const [consolidated, dailyHistory, categoryPopularity] = await Promise.all([
      adminModel.getConsolidatedFinancialMetrics(),
      adminModel.getDailyFinancialHistory(),
      adminModel.getCategoryPopularity()
    ]);

    return res.status(200).json({
      success: true,
      data: {
        consolidated,
        dailyHistory,
        categoryPopularity
      }
    });
  } catch (error) {
    console.error('Error al obtener el resumen financiero:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno al obtener el resumen financiero del dashboard.'
    });
  }
}

module.exports = {
  getAllActiveAlerts,
  resolveSOSAlert,
  verifyProvider,
  approvePayout,
  getPendingProvidersList,
  approveProvider,
  rejectProvider,
  verifyProviderAuto,
  getFinancialSummary
};

