import Joi from 'joi'

export interface IChangesEnv {
  CHANGES_S3_BUCKET?: string
  CHANGES_S3_PREFIX?: string
  CHANGES_GC_GRACE_MS?: number
}

export const changesEnvSchema = {
  CHANGES_S3_BUCKET: Joi.string().optional(),
  CHANGES_S3_PREFIX: Joi.string()
    .pattern(/^[a-z0-9][a-z0-9-]*$/)
    .default('worktree-changes'),
  CHANGES_GC_GRACE_MS: Joi.number()
    .integer()
    .min(0)
    .default(7 * 24 * 60 * 60 * 1000),
}
