import Joi from 'joi'

export interface IGithubEnv {
  GITHUB_CLIENT_ID?: string
  GITHUB_APP_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GITHUB_APP_PRIVATE_KEY?: string
  GITHUB_FACTORY_WEBHOOK_SECRET?: string
}

export const githubEnvSchema = {
  GITHUB_CLIENT_ID: Joi.string().optional(),
  GITHUB_APP_ID: Joi.string().optional(),
  GITHUB_CLIENT_SECRET: Joi.string().optional(),
  GITHUB_APP_PRIVATE_KEY: Joi.string().optional(),
  GITHUB_FACTORY_WEBHOOK_SECRET: Joi.string().optional(),
}
