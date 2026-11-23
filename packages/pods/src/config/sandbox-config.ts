import { decodeSettingValue, validateCloudSetting } from '@dltech/atlas-core'
import type { Db } from '@dltech/atlas-db'
import {
  DEFAULT_SANDBOX_PROVIDER,
  ECredentialSource,
  ESandboxProvider,
} from '@dltech/atlas-protocol'
import { z } from 'zod'

import type { PodsEnv } from '../env'
import { BYOK_RETIRED_GAP } from '../runtime/sandbox-not-configured-error'
import type { SandboxCredentials } from '../sandbox/sandbox-provider'
import { platformCredentialsOf } from './platform-credentials'

export type SandboxConfig =
  | {
      configured: true
      provider: ESandboxProvider
      credentials: SandboxCredentials
      vcpus?: number | undefined
      diskGb?: number | undefined
    }
  | { configured: false; provider: ESandboxProvider; gap: string }

export type SandboxPlatform = Pick<PodsEnv, 'platformVercel' | 'agent37'>

export type SandboxConfigSource = {
  read(args: { sessionId: string }): Promise<SandboxConfig>
}

export class SessionNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`session ${sessionId} not found`)
    this.name = 'SessionNotFoundError'
  }
}

const SANDBOX_VCPUS_KEY = 'sandbox.vcpus'
const SANDBOX_DISK_GB_KEY = 'sandbox.diskGb'

const sandboxProviderOf = (pinned: string | null | undefined): ESandboxProvider => {
  const value = pinned?.trim() ?? ''
  if (value === '') return DEFAULT_SANDBOX_PROVIDER
  return z.nativeEnum(ESandboxProvider).parse(value)
}

const sandboxOf = (args: {
  provider: ESandboxProvider
  credentialSource: string
  vcpus: number | undefined
  diskGb: number | undefined
  platform: SandboxPlatform
}): SandboxConfig => {
  if (args.credentialSource !== ECredentialSource.Platform) {
    return { configured: false, provider: args.provider, gap: BYOK_RETIRED_GAP }
  }
  const credentials = platformCredentialsOf({ provider: args.provider, env: args.platform })
  if ('configured' in credentials) {
    return { configured: false, provider: args.provider, gap: credentials.gap }
  }
  return {
    configured: true,
    provider: args.provider,
    credentials,
    ...(args.vcpus === undefined ? {} : { vcpus: args.vcpus }),
    ...(args.diskGb === undefined ? {} : { diskGb: args.diskGb }),
  }
}

const personalNumberSettingOf = async (args: {
  db: Db
  userId: string
  key: string
}): Promise<number | undefined> => {
  const row = await args.db.orm.public.UserSetting.where({
    userId: args.userId,
    key: args.key,
  })
    .select('value')
    .first()
  if (row === null) return undefined
  if (!validateCloudSetting({ key: args.key, stored: row.value }).ok) return undefined
  const value = decodeSettingValue(row.value)
  return typeof value === 'number' ? value : undefined
}

export const readSandboxConfig = async (args: {
  db: Db
  platform: SandboxPlatform
  sessionId: string
}): Promise<SandboxConfig> => {
  const session = await args.db.orm.v2.V2Session.first({ id: args.sessionId })
  if (session === null) throw new SessionNotFoundError(args.sessionId)
  const project =
    session.projectId === null
      ? null
      : await args.db.orm.public.Project.first({ id: session.projectId })
  const [personalVcpus, personalDiskGb] = await Promise.all([
    personalNumberSettingOf({ db: args.db, userId: session.userId, key: SANDBOX_VCPUS_KEY }),
    personalNumberSettingOf({ db: args.db, userId: session.userId, key: SANDBOX_DISK_GB_KEY }),
  ])
  return sandboxOf({
    provider: sandboxProviderOf(session.sandboxProvider),
    credentialSource: session.credentialSource,
    vcpus: project?.sandboxVcpus ?? personalVcpus,
    diskGb: project?.sandboxDiskGb ?? personalDiskGb,
    platform: args.platform,
  })
}

export const sandboxConfigSourceOf = (args: {
  db: Db
  env: SandboxPlatform
}): SandboxConfigSource => ({
  read: ({ sessionId }) => readSandboxConfig({ db: args.db, platform: args.env, sessionId }),
})
