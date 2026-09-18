import Joi from 'joi'

export interface IDatabaseEnv {
  DATABASE_URL: string
  DIRECT_URL?: string
}

export const databaseEnvSchema = {
  DATABASE_URL: Joi.string()
    .pattern(/^postgres(ql)?:\/\//)
    .required(),
  DIRECT_URL: Joi.string()
    .pattern(/^postgres(ql)?:\/\//)
    .optional(),
}
