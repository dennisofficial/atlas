import Joi from 'joi'

export interface IEmailEnv {
  RESEND_API_KEY: string
  EMAIL_FROM: string
}

export const emailEnvSchema = {
  RESEND_API_KEY: Joi.string().required(),
  EMAIL_FROM: Joi.string().default('Atlas <noreply@mail.byatlas.io>'),
}
