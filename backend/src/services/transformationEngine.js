// backend/src/services/transformationEngine.js
const atenaAgent = require('./agents/atenaAgent');
const hestiaAgent = require('./agents/hestiaAgent');
const hermesAgent = require('./agents/hermesAgent');
const logger = require('../config/logger');

class TransformationEngine {
  /**
   * Genera un plan de intervención estructurado con rutina AM/PM y sugerencias comerciales opcionales
   */
  async generateTransformationPlan({
    userId,
    cycleType = 'skin',
    faceScores = {},
    handsDiagnosis = {},
    targetGoal,
    targetMetricKey = 'hydration',
    userLocation = null
  }) {
    logger.info('Generando Plan de Transformación Adaptativo', { userId, cycleType, targetMetricKey });

    // 1. Atena determina los principios activos e intervenciones según diagnóstico
    const targetIngredients = this._determineTargetIngredients(faceScores, targetMetricKey);
    const priorities = this._extractPriorities(faceScores, targetMetricKey);

    // 2. Construir la Rutina AM y PM ejecutable (Pasos y hábitos)
    const amRoutine = this._buildAmRoutine(targetMetricKey, targetIngredients, cycleType);
    const pmRoutine = this._buildPmRoutine(targetMetricKey, targetIngredients, cycleType);

    // 3. Consultar productos adecuados con Hestia (Opcional, subordinado al plan)
    let recommendedProducts = [];
    try {
      const productRes = await hestiaAgent.recommendProducts({
        userId,
        category: cycleType === 'hands' ? 'Uñas' : 'Piel'
      });
      if (productRes && productRes.products) {
        recommendedProducts = productRes.products.map(p => ({
          id: p.id,
          name: p.nombre,
          price: p.precio,
          category: p.categoria,
          reason: `Formulado con activos compatibles para optimizar ${targetMetricKey}.`
        }));
      }
    } catch (e) {
      logger.warn('Fallo al obtener productos con Hestia, continuando sin productos forzados:', e.message);
    }

    // 4. Consultar servicios profesionales con Hermes (Si la condición lo amerita y hay ubicación)
    let recommendedServices = [];
    if (userLocation && userLocation.latitude && userLocation.longitude && (faceScores.pores > 50 || faceScores.wrinkles > 40)) {
      try {
        const serviceRes = await hermesAgent.findNearbyServices({
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          category: 'Piel',
          maxDistanceKm: 10
        });
        if (serviceRes && serviceRes.services) {
          recommendedServices = serviceRes.services.map(s => ({
            id: s.service_id,
            name: s.name,
            providerId: s.provider_id,
            businessName: s.business_name,
            price: s.price,
            distanceKm: s.distance_km,
            reason: 'Tratamiento profesional complementario para acelerar el resultado del ciclo.'
          }));
        }
      } catch (e) {
        logger.warn('Fallo al obtener servicios con Hermes:', e.message);
      }
    }

    const planSummary = `Plan de Transformación Beauty enfocado en ${targetMetricKey}. Incluye rutina AM/PM con ${targetIngredients.join(', ')} y hábitos de hidratación diaria.`;

    return {
      success: true,
      cycleType,
      targetMetricKey,
      priorities,
      targetIngredients,
      planSummary,
      amRoutine,
      pmRoutine,
      recommendedProducts,
      recommendedServices
    };
  }

  /**
   * Adapta una rutina existente basada en la evolución (Delta) de un re-escaneo
   */
  adaptPlanBasedOnDelta({
    currentPlan,
    delta,
    metricKey,
    currentValue,
    targetValue
  }) {
    logger.info('Adaptando plan según Delta evolutivo', { metricKey, delta, currentValue, targetValue });

    const isGoalReached = currentValue >= targetValue;
    let adaptationType = 'maintain';
    let adaptationReason = '';
    let updatedAm = [...(currentPlan.amRoutine || [])];
    let updatedPm = [...(currentPlan.pmRoutine || [])];

    if (isGoalReached) {
      adaptationType = 'completed';
      adaptationReason = `¡Objetivo de ${metricKey} alcanzado con éxito (${currentValue}/${targetValue})! Pasando a fase de mantenimiento o nuevo ciclo.`;
    } else if (delta > 0) {
      adaptationType = 'maintain';
      adaptationReason = `Progreso positivo (+${delta} en ${metricKey}). Mantenemos la rutina actual con refuerzo de hidratación.`;
    } else if (delta === 0) {
      adaptationType = 'intensify';
      adaptationReason = `Estabilidad dérmica. Intensificamos el paso de sérum en rutina nocturna para estimular avance.`;
      updatedPm.push({
        step: updatedPm.length + 1,
        time: '21:00',
        action: 'Aplicación de Mascarilla Reparadora / Booster',
        ingredient: 'Ceramidas + Niacinamida',
        reason: 'Estimulación de barrera dérmica ante meseta de progreso.'
      });
    } else {
      adaptationType = 'modify';
      adaptationReason = `Variación no esperada (${delta} puntos). Atena ajusta la fórmula reemplazando activos irritantes por emolientes calmantes.`;
      updatedAm = updatedAm.map(step => ({
        ...step,
        action: step.action.replace('Exfoliante', 'Limpiador Ultra-Suave'),
        reason: 'Sustitución por tolerancia dérmica.'
      }));
    }

    return {
      adaptationType,
      adaptationReason,
      isGoalReached,
      amRoutine: updatedAm,
      pmRoutine: updatedPm
    };
  }

  _determineTargetIngredients(scores, metricKey) {
    const ingredients = [];
    if (metricKey === 'hydration' || (scores.hydration && scores.hydration < 65)) {
      ingredients.push('Ácido Hialurónico', 'Pantenol', 'Glicerina vegetal');
    }
    if (metricKey === 'pores' || (scores.pores && scores.pores > 40)) {
      ingredients.push('Niacinamida 5%', 'Zinc PCA', 'Ácido Salicílico');
    }
    if (metricKey === 'wrinkles' || (scores.wrinkles && scores.wrinkles > 30)) {
      ingredients.push('Péptidos de Cobre', 'Retinol encapsulado');
    }
    if (ingredients.length === 0) {
      ingredients.push('Antioxidantes Vitamin Complex', 'Ceramidas');
    }
    return Array.from(new Set(ingredients));
  }

  _extractPriorities(scores, metricKey) {
    const priorities = [`Optimización de ${metricKey}`];
    if (scores.hydration && scores.hydration < 50) priorities.push('Recuperación de barrera lipídica');
    if (scores.pores && scores.pores > 50) priorities.push('Refinamiento de textura dérmica');
    return priorities;
  }

  _buildAmRoutine(metricKey, ingredients, cycleType = 'skin') {
    if (cycleType === 'hands') {
      return [
        {
          step: 1,
          time: '08:00',
          action: 'Lavado con jabón sin fragancia + Aplicación de Bálsamo de Manos con Urea',
          ingredient: 'Urea 10% + Pantenol',
          reason: 'Restauración de la barrera cutánea en manos y cutículas.'
        },
        {
          step: 2,
          time: '08:05',
          action: 'Protector solar para dorso de manos SPF 50',
          ingredient: 'Filtro UV fotoestable',
          reason: 'Prevención de fotoenvejecimiento y manchas pigmentarias en manos.'
        }
      ];
    }

    if (cycleType === 'color') {
      return [
        {
          step: 1,
          time: '08:00',
          action: 'Preparación de tez con primer hidratante iluminador',
          ingredient: 'Niacinamida + Perlas reflectoras',
          reason: 'Neutralización de subtono y base uniforme para la paleta estacional.'
        },
        {
          step: 2,
          time: '08:15',
          action: 'Aplicación de labial y rubor en tonos de armonía personalizada',
          ingredient: 'Pigmentos botánicos calibrados',
          reason: 'Realce del contraste natural conforme al test cromático.'
        }
      ];
    }

    return [
      {
        step: 1,
        time: '07:30',
        action: 'Limpieza suave con limpiador base agua sin sulfatos',
        ingredient: 'Agua termal',
        reason: 'Remover sebo nocturno sin agredir la barrera lipídica.'
      },
      {
        step: 2,
        time: '07:35',
        action: `Aplicación de Sérum Facial de ${ingredients[0] || 'Hidratación'}`,
        ingredient: ingredients[0] || 'Ácido Hialurónico',
        reason: `Tratamiento directo para la meta de ${metricKey}.`
      },
      {
        step: 3,
        time: '07:40',
        action: 'Protector Solar SPF 50+ de amplio espectro',
        ingredient: 'Filtros solares minerales / fotoestables',
        reason: 'Protección celular obligatoria contra fotodaño y manchas.'
      }
    ];
  }

  _buildPmRoutine(metricKey, ingredients, cycleType = 'skin') {
    if (cycleType === 'hands') {
      return [
        {
          step: 1,
          time: '21:30',
          action: 'Aceite nutritivo para cutículas y matriz ungueal',
          ingredient: 'Aceite de Almendras dulces + Vitamina E',
          reason: 'Nutrición intensiva y fortalecimiento de uñas.'
        },
        {
          step: 2,
          time: '21:35',
          action: 'Capa oclusiva de ungüento reparador para manos',
          ingredient: 'Manteca de Karité + Ceramidas',
          reason: 'Tratamiento intensivo nocturno para sellar hidratación en manos.'
        }
      ];
    }

    if (cycleType === 'color') {
      return [
        {
          step: 1,
          time: '20:30',
          action: 'Desmaquillado suave con bálsamo oleoso',
          ingredient: 'Escualano + Camomila',
          reason: 'Remoción de pigmentos sin irritar la barrera dérmica.'
        },
        {
          step: 2,
          time: '20:35',
          action: 'Tratamiento iluminador nocturno',
          ingredient: 'Vitamina C estable / Ácido Tranexámico',
          reason: 'Unificación del tono para potenciar la luminosidad natural.'
        }
      ];
    }

    return [
      {
        step: 1,
        time: '20:30',
        action: 'Doble limpieza / Limpiador emoliente',
        ingredient: 'Aceite de jojoba / Espuma suave',
        reason: 'Eliminación de protector solar y polución acumulada.'
      },
      {
        step: 2,
        time: '20:35',
        action: `Aplicación de Crema Reparadora Nocturna con ${ingredients[1] || 'Ceramidas'}`,
        ingredient: ingredients[1] || 'Ceramidas',
        reason: 'Regeneración celular y sellado de hidratación durante el descanso.'
      }
    ];
  }
}

module.exports = new TransformationEngine();
