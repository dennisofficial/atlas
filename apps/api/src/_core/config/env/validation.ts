import Joi from 'joi'
import type { IAiEnv } from './sections/ai'
import { aiEnvSchema } from './sections/ai'
import type { IAuthEnv } from './sections/auth'
import { authEnvSchema } from './sections/auth'
import type { IBlobEnv } from './sections/blob'
import { blobEnvSchema } from './sections/blob'
import type { IArtifactsEnv } from './sections/artifacts'
import { artifactsEnvSchema } from './sections/artifacts'
import type { IChangesEnv } from './sections/changes'
import { changesEnvSchema } from './sections/changes'
import type { ICloudflareEnv } from './sections/cloudflare'
import { cloudflareEnvSchema } from './sections/cloudflare'
import type { ICryptoEnv } from './sections/crypto'
import { cryptoEnvSchema } from './sections/crypto'
import type { IDatabaseEnv } from './sections/database'
import { databaseEnvSchema } from './sections/database'
import type { IEmailEnv } from './sections/email'
import { emailEnvSchema } from './sections/email'
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
import type { IVercelOauthEnv } from './sections/vercel-oauth'
import { vercelOauthEnvSchema } from './sections/vercel-oauth'
import type { IWebEnv } from './sections/web'
import { webEnvSchema } from './sections/web'
import type { IWebPushEnv } from './sections/web-push'
import { webPushEnvSchema } from './sections/web-push'

export interface IEnvConfig
  extends IRuntimeEnv,
    IAiEnv,
    IAuthEnv,
    IBlobEnv,
    IArtifactsEnv,
    IChangesEnv,
    ICloudflareEnv,
    IDatabaseEnv,
    ICryptoEnv,
    IEmailEnv,
    IGithubEnv,
    IRedisEnv,
    ISandboxEnv,
    ITriggerEnv,
    IVercelOauthEnv,
    IWebPushEnv,
    IWebEnv {}

export const envConfigValidation = Joi.object({
  ...runtimeEnvSchema,
  ...aiEnvSchema,
  ...authEnvSchema,
  ...blobEnvSchema,
  ...artifactsEnvSchema,
  ...changesEnvSchema,
  ...cloudflareEnvSchema,
  ...databaseEnvSchema,
  ...cryptoEnvSchema,
  ...emailEnvSchema,
  ...githubEnvSchema,
  ...redisEnvSchema,
  ...sandboxEnvSchema,
  ...triggerEnvSchema,
  ...vercelOauthEnvSchema,
  ...webPushEnvSchema,
  ...webEnvSchema,
})
