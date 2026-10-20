import Joi from 'joi'
import type { IAuthEnv } from './sections/auth'
import { authEnvSchema } from './sections/auth'
import type { IBlobEnv } from './sections/blob'
import { blobEnvSchema } from './sections/blob'
import type { ICryptoEnv } from './sections/crypto'
import { cryptoEnvSchema } from './sections/crypto'
import type { IDatabaseEnv } from './sections/database'
import { databaseEnvSchema } from './sections/database'
import type { IGithubEnv } from './sections/github'
import { githubEnvSchema } from './sections/github'
import type { IRedisEnv } from './sections/redis'
import { redisEnvSchema } from './sections/redis'
import type { IRuntimeEnv } from './sections/runtime'
import { runtimeEnvSchema } from './sections/runtime'
import type { ISandboxEnv } from './sections/sandbox'
import { sandboxEnvSchema } from './sections/sandbox'
import type { ITriggerEnv } from './sections/trigger'
import { triggerEnvSchema } from './sections/trigger'

export interface IEnvConfig
  extends IRuntimeEnv,
    IAuthEnv,
    IBlobEnv,
    IDatabaseEnv,
    ICryptoEnv,
    IGithubEnv,
    IRedisEnv,
    ISandboxEnv,
    ITriggerEnv {}

export const envConfigValidation = Joi.object({
  ...runtimeEnvSchema,
  ...authEnvSchema,
  ...blobEnvSchema,
  ...databaseEnvSchema,
  ...cryptoEnvSchema,
  ...githubEnvSchema,
  ...redisEnvSchema,
  ...sandboxEnvSchema,
  ...triggerEnvSchema,
})
