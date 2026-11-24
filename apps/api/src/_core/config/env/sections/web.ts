import Joi from 'joi'

export interface IWebEnv {
  JINA_API_KEY?: string
}

export const webEnvSchema = {
  JINA_API_KEY: Joi.string().optional(),
}
