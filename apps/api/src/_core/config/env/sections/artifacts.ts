import Joi from 'joi'

export interface IArtifactsEnv {
  ARTIFACT_DOMAIN: string
  ARTIFACT_STORAGE: 'vercel' | 's3'
  ARTIFACT_BLOB_READ_WRITE_TOKEN?: string
  ARTIFACT_BLOB_BASE_URL?: string
  ARTIFACT_S3_ENDPOINT?: string
  ARTIFACT_S3_REGION?: string
  ARTIFACT_S3_BUCKET?: string
  ARTIFACT_S3_ACCESS_KEY_ID?: string
  ARTIFACT_S3_SECRET_ACCESS_KEY?: string
}

const suppliedWithS3 = (schema: Joi.StringSchema): Joi.StringSchema =>
  schema.when('ARTIFACT_STORAGE', { is: 's3', then: Joi.required(), otherwise: Joi.optional() })

export const artifactsEnvSchema = {
  ARTIFACT_DOMAIN: Joi.string()
    .pattern(/^[a-z0-9.-]+$/)
    .default('byatlas.site'),
  ARTIFACT_STORAGE: Joi.string().valid('vercel', 's3').default('vercel'),
  ARTIFACT_BLOB_READ_WRITE_TOKEN: Joi.string().optional(),
  ARTIFACT_BLOB_BASE_URL: suppliedWithS3(Joi.string().uri({ scheme: ['https'] })),
  ARTIFACT_S3_ENDPOINT: suppliedWithS3(Joi.string().uri({ scheme: ['https', 'http'] })),
  ARTIFACT_S3_REGION: suppliedWithS3(Joi.string()),
  ARTIFACT_S3_BUCKET: suppliedWithS3(Joi.string()),
  ARTIFACT_S3_ACCESS_KEY_ID: suppliedWithS3(Joi.string()),
  ARTIFACT_S3_SECRET_ACCESS_KEY: suppliedWithS3(Joi.string()),
}
