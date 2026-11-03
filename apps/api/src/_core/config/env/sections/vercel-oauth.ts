import Joi from 'joi'

export interface IVercelOauthEnv {
  VERCEL_OAUTH_CLIENT_ID?: string
  VERCEL_OAUTH_CLIENT_SECRET?: string
}

export const vercelOauthEnvSchema = {
  VERCEL_OAUTH_CLIENT_ID: Joi.string().optional(),
  VERCEL_OAUTH_CLIENT_SECRET: Joi.string().optional(),
}
