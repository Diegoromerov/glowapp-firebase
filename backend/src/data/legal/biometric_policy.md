# Política de Tratamiento de Datos Biométricos - GlowApp

**Versión:** 1.0  
**Última actualización:** 2026-08-05  
**Responsable:** GlowApp SAS  
**Contacto:** privacidad@glowapp.com  

---

## 1. Identificación del Responsable del Tratamiento

**Razón Social:** GlowApp SAS  
**NIT:** 901.234.567-8  
**Domicilio:** Carrera 7 # 71-21, Bogotá, Colombia  
**Teléfono:** +57 1 744 0000  
**Email DPO:** privacidad@glowapp.com  
**Representante Legal:** [Nombre Representante Legal]  
**Oficial de Protección de Datos:** [Nombre DPO]

---

## 2. Finalidad del Tratamiento

Los datos biométricos (rostro, piel, cabello, medidas corporales) se procesan exclusivamente para:

1. **Análisis facial completo** - Determinación de tipo de piel, tono, textura, características faciales
2. **Recomendación de rutinas cosméticas** - Personalización basada en características biométricas únicas
3. **Prueba virtual de productos** - Visualización realista de maquillaje, cabello, cuidado facial
4. **Mejora de recomendaciones** - Aprendizaje continuo para mayor precisión en sugerencias
5. **Historial de tratamientos** - Seguimiento de evolución y resultados

---

## 3. Tipos de Datos Biométricos Procesados

| Categoría | Datos Específicos | Finalidad |
|-----------|-------------------|-----------|
| **Facial** | Embeddings vectoriales (512-d), landmarks faciales (68 pts), tipo de piel, tono, textura, hidratación, edad estimada | Análisis facial, recomendación rutinas, virtual try-on |
| **Piel** | Tipo (seca/grasa/mixta/sensible), hidratación, tono, subtono, manchas, poros, arrugas, sensibilidad | Recomendación productos, rutinas, tratamientos |
| **Cabello** | Tipo (liso/ondulado/rizado), textura, porosidad, color, densidad, condición cuero cabelludo | Recomendación productos capilares, tratamientos |
| **Corporal** | Medidas antropométricas, IMC, composición corporal | Recomendación tratamientos corporales, wellness |

**NOTA:** NO se almacenan imágenes originales. Solo representaciones matemáticas (embeddings vectoriales) irreversibles.

---

## 4. Derechos del Titular (Ley 1581/2012)

Conforme al **Artículo 8 de la Ley 1581/2012**, usted tiene derecho a:

| Derecho | Descripción | Cómo Ejercerlo |
|---------|-------------|----------------|
| **Acceso** | Conocer qué datos biométricos tenemos sobre usted | GET `/api/consent/history` |
| **Actualización/Rectificación** | Corregir datos inexactos o incompletos | POST `/api/consent/grant` con propósito actualizado |
| **Supresión** | Eliminar sus datos biométricos en cualquier momento | DELETE `/api/consent/data` |
| **Revocatoria** | Retirar consentimiento sin efecto retroactivo | POST `/api/consent/revoke` |
| **Queja** | Presentar queja ante la SIC si considera vulnerados sus derechos | Email: sic@sic.gov.co |

**Importante:** La revocatoria del consentimiento no tiene efectos retroactivos. Los tratamientos realizados mientras el consentimiento estuvo vigente son lícitos.

---

## 5. Mecanismos para Ejercer Derechos

| Canal | Detalles |
|-------|----------|
| **App GlowApp** | Configuración > Privacidad > Datos Biométricos |
| **Email** | privacidad@glowapp.com (respuesta en 15 días hábiles) |
| **PQR App** | Sección Ayuda > PQR > Derechos de Datos |
| **Correo Postal** | Carrera 7 # 71-21, Bogotá - Att: Oficial Protección Datos |
| **App Móvil** | Configuración > Privacidad > Mis Derechos |

**Tiempo de respuesta:** 15 días hábiles (prorrogable por 8 días más si la complejidad lo requiere).

---

## 6. Tiempo de Retención de Datos

| Tipo de Dato | Tiempo de Retención | Criterio |
|--------------|---------------------|----------|
| **Datos biométricos activos** | Mientras el consentimiento esté vigente | Consentimiento expreso |
| **Datos tras revocatoria** | Eliminación en 24 horas | Derecho de supresión (Art. 15) |
| **Logs de auditoría** | 5 años | Decreto 1377/2013 Art. 17 |
| **Historial de consentimientos** | Indefinido (auditoría legal) | Decreto 1377/2013 Art. 17 |
| **Embeddings vectoriales** | Mientras consentimiento vigente | Se eliminan en 24h tras revocatoria |

**Eliminación:** Al revocar consentimiento, los datos biométricos se eliminan físicamente en **máximo 24 horas**. Solo se mantiene el registro de consentimiento revocado para auditoría legal (Decreto 1377/2013).

---

## 7. Seguridad de la Información

| Medida | Descripción |
|--------|-------------|
| **Cifrado en reposo** | AES-256 para embeddings y datos sensibles |
| **Cifrado en tránsito** | TLS 1.3 obligatorio |
| **Control de acceso** | RBAC + consentimiento explícito por operación |
| **Pseudonimización** | Embeddings irreversibles, no reversibles a imagen |
| **Auditoría** | Log inmutable de cada acceso (biometric_access_log) |
| **Monitoreo** | Alertas de accesos anómalos, rate limiting por usuario/IP |

---

## 8. Transferencias de Datos

| Destino | Finalidad | Garantías |
|---------|-----------|-----------|
| **NVIDIA (EE.UU.)** | Inferencia embeddings (NV-Embed-QA) | Cláusulas Contractuales Tipo SIC, no almacenamiento |
| **Google Cloud (EE.UU.)** | Hosting, base de datos | Cláusulas Contractuales Tipo, certificación ISO 27001 |
| **Proveedores locales** | Servicios complementarios | Contratos con cláusulas de protección de datos |

**Base legal:** Cláusulas Contractuales Tipo aprobadas por la Superintendencia de Industria y Comercio (SIC).

---

## 9. Autoridad de Control

**Superintendencia de Industria y Comercio (SIC)**  
Dirección de Protección de Datos Personales  
Carrera 13 No. 27-00, Bogotá, Colombia  
Tel: +57 1 592 0400  
Web: www.sic.gov.co  
Email: protecciondatos@sic.gov.co

---

## 10. Contacto del Oficial de Protección de Datos (DPO)

**Nombre:** [Nombre DPO]  
**Email:** dpo@glowapp.com  
**Teléfono:** +57 1 744 0000 ext. 100  
**Disponibilidad:** Lunes a Viernes 8:00 AM - 5:00 PM (hora Colombia)

---

## 11. Versión y Vigencia

| Campo | Valor |
|-------|-------|
| **Versión** | 1.0 |
| **Fecha de entrada en vigencia** | 2026-08-05 |
| **Próxima revisión programada** | 2027-02-05 |
| **Estado** | Vigente |

**Cambios en esta versión:**
- Versión inicial completa conforme Ley 1581/2012 y Decreto 1377/2013

---

**GlowApp SAS** se compromete a proteger su privacidad y garantizar el ejercicio efectivo de sus derechos como titular de datos biométricos, cumpliendo estrictamente la normativa colombiana vigente.