/**
 * GLOWAPP BUSINESS VALIDATORS
 * Input validation schemas using Zod for Business REST API endpoints.
 * Complies with backend-dev-guidelines (Zero Unvalidated Input Doctrine).
 */

const { z } = require('zod');

const diagnosticSchema = z.object({
  onboarding_mode: z.string().optional().default('NEW_BUSINESS'),
  vertical_code: z.string().optional().default('BEAUTY_SALON'),
  name: z.string().optional().default('Mi Peluquería Studio'),
  city: z.string().optional().default('Bogotá'),
  country: z.string().optional().default('Colombia'),
  answers: z.record(z.any()).optional().default({}),
});

const generateDocSchema = z.object({
  template_code: z.string().optional().default('TPL_LABOR_CONTRACT_BEAUTY'),
  variables: z.record(z.any()).optional().default({}),
  business_profile_id: z.string().optional().nullable(),
});

const signDocSchema = z.object({
  signer_name: z.string().optional(),
  signature_hash: z.string().optional(),
});

const advanceTaskSchema = z.object({
  action: z.string().optional(),
  stage: z.string().optional(),
  notes: z.string().optional(),
});

const submitEvidenceSchema = z.object({
  file_path: z.string().optional(),
  evidence_url: z.string().optional(),
  evidence_type: z.enum(['DOCUMENT', 'PHOTO', 'CONTRACT', 'FORM', 'DECLARATION']).optional(),
  file_type: z.string().optional(),
  notes: z.string().optional(),
});

module.exports = {
  diagnosticSchema,
  generateDocSchema,
  signDocSchema,
  advanceTaskSchema,
  submitEvidenceSchema,
};
