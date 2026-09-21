import Joi from 'joi'

export interface IFactoryEnv {
  FACTORY_MODEL_PROVIDER?: string
  FACTORY_MODEL_API_KEY?: string
}

export const factoryEnvSchema = {
  FACTORY_MODEL_PROVIDER: Joi.string().optional(),
  FACTORY_MODEL_API_KEY: Joi.string().optional(),
}
