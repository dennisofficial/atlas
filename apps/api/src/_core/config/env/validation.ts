import Joi from 'joi'
import type { IAuthEnv } from './sections/auth'
import { authEnvSchema } from './sections/auth'
import type { ICryptoEnv } from './sections/crypto'
import { cryptoEnvSchema } from './sections/crypto'
import type { IDatabaseEnv } from './sections/database'
import { databaseEnvSchema } from './sections/database'
import type { IGithubEnv } from './sections/github'
import { githubEnvSchema } from './sections/github'
import type { IRuntimeEnv } from './sections/runtime'
import { runtimeEnvSchema } from './sections/runtime'

export interface IEnvConfig
  extends IRuntimeEnv,
    IAuthEnv,
    IDatabaseEnv,
    ICryptoEnv,
    IGithubEnv {}

export const envConfigValidation = Joi.object({
  ...runtimeEnvSchema,
  ...authEnvSchema,
  ...databaseEnvSchema,
  ...cryptoEnvSchema,
  ...githubEnvSchema,
})
