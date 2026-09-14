import Joi from 'joi'

export interface IGithubEnv {
  GITHUB_CLIENT_ID?: string
}

export const githubEnvSchema = {
  GITHUB_CLIENT_ID: Joi.string().optional(),
}
