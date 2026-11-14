import Joi from 'joi'

export interface IArtifactsEnv {
  ARTIFACT_DOMAIN: string
  ARTIFACT_S3_ENDPOINT?: string
  ARTIFACT_S3_REGION?: string
  ARTIFACT_S3_BUCKET?: string
  ARTIFACT_S3_ACCESS_KEY_ID?: string
  ARTIFACT_S3_SECRET_ACCESS_KEY?: string
}

export const artifactsEnvSchema = {
  ARTIFACT_DOMAIN: Joi.string()
    .pattern(/^[a-z0-9.-]+$/)
    .default('byatlas.site'),
  ARTIFACT_S3_ENDPOINT: Joi.string()
    .uri({ scheme: ['https', 'http'] })
    .optional(),
  ARTIFACT_S3_REGION: Joi.string().optional(),
  ARTIFACT_S3_BUCKET: Joi.string().optional(),
  ARTIFACT_S3_ACCESS_KEY_ID: Joi.string().optional(),
  ARTIFACT_S3_SECRET_ACCESS_KEY: Joi.string().optional(),
}
