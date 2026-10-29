import Joi from 'joi'

export interface ICloudflareEnv {
  CLOUDFLARE_API_TOKEN: string
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_ZONE_ID: string
  PREVIEW_DOMAIN: string
}

export const cloudflareEnvSchema = {
  CLOUDFLARE_API_TOKEN: Joi.string().required(),
  CLOUDFLARE_ACCOUNT_ID: Joi.string().required(),
  CLOUDFLARE_ZONE_ID: Joi.string().required(),
  PREVIEW_DOMAIN: Joi.string().default('byatlas.dev'),
}
