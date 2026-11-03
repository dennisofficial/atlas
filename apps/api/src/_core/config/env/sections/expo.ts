import Joi from 'joi'

export interface IExpoEnv {
  EXPO_ACCESS_TOKEN?: string
}

export const expoEnvSchema = {
  EXPO_ACCESS_TOKEN: Joi.string().optional(),
}
