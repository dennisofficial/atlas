import Joi from 'joi'

export interface IBlobEnv {
  BLOB_READ_WRITE_TOKEN?: string
}

export const blobEnvSchema = {
  BLOB_READ_WRITE_TOKEN: Joi.string()
    .pattern(/^vercel_blob_rw_/)
    .optional(),
}
