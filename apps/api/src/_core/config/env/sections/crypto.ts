import Joi from 'joi'

export interface ICryptoEnv {
  SECRETS_ENCRYPTION_KEY: string
}

export const cryptoEnvSchema = {
  SECRETS_ENCRYPTION_KEY: Joi.string().required(),
}
