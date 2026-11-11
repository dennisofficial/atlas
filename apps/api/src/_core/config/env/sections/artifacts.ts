import Joi from 'joi'

export interface IArtifactsEnv {
  ARTIFACT_DOMAIN: string
  ARTIFACT_BLOB_READ_WRITE_TOKEN?: string
}

export const artifactsEnvSchema = {
  ARTIFACT_DOMAIN: Joi.string()
    .pattern(/^[a-z0-9.-]+$/)
    .default('byatlas.site'),
  ARTIFACT_BLOB_READ_WRITE_TOKEN: Joi.string().optional(),
}
