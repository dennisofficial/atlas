import Joi from 'joi'
import type { IAuthEnv } from './sections/auth'
import { authEnvSchema } from './sections/auth'
import type { ICryptoEnv } from './sections/crypto'
import { cryptoEnvSchema } from './sections/crypto'
import type { IDatabaseEnv } from './sections/database'
import { databaseEnvSchema } from './sections/database'
import type { IFactoryEnv } from './sections/factory'
import { factoryEnvSchema } from './sections/factory'
import type { IGithubEnv } from './sections/github'
import { githubEnvSchema } from './sections/github'
import type { ILinearEnv } from './sections/linear'
import { linearEnvSchema } from './sections/linear'
import type { IRuntimeEnv } from './sections/runtime'
import { runtimeEnvSchema } from './sections/runtime'
import type { ISandboxEnv } from './sections/sandbox'
import { sandboxEnvSchema } from './sections/sandbox'

export interface IEnvConfig
  extends IRuntimeEnv,
    IAuthEnv,
    IDatabaseEnv,
    ICryptoEnv,
    IGithubEnv,
    ILinearEnv,
    IFactoryEnv,
    ISandboxEnv {}

export const envConfigValidation = Joi.object({
  ...runtimeEnvSchema,
  ...authEnvSchema,
  ...databaseEnvSchema,
  ...cryptoEnvSchema,
  ...githubEnvSchema,
  ...linearEnvSchema,
  ...factoryEnvSchema,
  ...sandboxEnvSchema,
})
