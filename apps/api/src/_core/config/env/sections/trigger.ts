import Joi from 'joi'

export interface ITriggerEnv {
  TRIGGER_JOBS_SECRET_KEY: string
}

export const triggerEnvSchema = {
  TRIGGER_JOBS_SECRET_KEY: Joi.string().required(),
}
