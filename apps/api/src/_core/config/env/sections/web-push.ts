import Joi from 'joi'

export interface IWebPushEnv {
  WEB_PUSH_PUBLIC_KEY?: string
}

export const webPushEnvSchema = {
  WEB_PUSH_PUBLIC_KEY: Joi.string().optional().allow(''),
}
