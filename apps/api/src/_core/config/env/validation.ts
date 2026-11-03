import Joi from 'joi'
import type { IAuthEnv } from './sections/auth'
import { authEnvSchema } from './sections/auth'
import type { IBlobEnv } from './sections/blob'
import { blobEnvSchema } from './sections/blob'
import type { ICloudflareEnv } from './sections/cloudflare'
import { cloudflareEnvSchema } from './sections/cloudflare'
import type { ICryptoEnv } from './sections/crypto'
import { cryptoEnvSchema } from './sections/crypto'
import type { IDatabaseEnv } from './sections/database'
import { databaseEnvSchema } from './sections/database'
import type { IEmailEnv } from './sections/email'
import { emailEnvSchema } from './sections/email'
import type { IExpoEnv } from './sections/expo'
import { expoEnvSchema } from './sections/expo'
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
import type { IV2Env } from './sections/v2'
import { v2EnvSchema } from './sections/v2'
import type { IVercelOauthEnv } from './sections/vercel-oauth'
import { vercelOauthEnvSchema } from './sections/vercel-oauth'

export interface IEnvConfig
  extends IRuntimeEnv,
    IAuthEnv,
    IBlobEnv,
    ICloudflareEnv,
    IDatabaseEnv,
    ICryptoEnv,
    IEmailEnv,
    IExpoEnv,
    IGithubEnv,
    IRedisEnv,
    ISandboxEnv,
    ITriggerEnv,
    IV2Env,
    IVercelOauthEnv {}

export const envConfigValidation = Joi.object({
  ...runtimeEnvSchema,
  ...authEnvSchema,
  ...blobEnvSchema,
  ...cloudflareEnvSchema,
  ...databaseEnvSchema,
  ...cryptoEnvSchema,
  ...emailEnvSchema,
  ...expoEnvSchema,
  ...githubEnvSchema,
  ...redisEnvSchema,
  ...sandboxEnvSchema,
  ...triggerEnvSchema,
  ...v2EnvSchema,
  ...vercelOauthEnvSchema,
})
