import { db } from '@dltech/atlas-db'
import { ESandboxProvider } from '@dltech/atlas-protocol'

import type { ConfigSource } from '../config/agent-host-config'
import { configSourceOf } from '../config/config-source'
import { readAgentHostEnv } from '../config/env'
import { SecretCipher } from '../config/secret-cipher'
import type { SandboxProviderRegistry } from './provider-registry'
import { sandboxCumulativeCpuMsOf } from './sandbox-runs'
import { sandboxProvidersOf } from './sandbox-providers'

const LIVE_CPU_TTL_MS = 30_000
const CACHE_LIMIT = 512

export type LiveSandboxCpu = {
  cumulativeCpuMs(args: { sessionId: string }): Promise<number | undefined>
}

type CachedReading = { at: number; value: Promise<number | undefined> }

const readingOf = async (args: {
  config: Pick<ConfigSource, 'read'>
  sandbox: SandboxProviderRegistry
  sessionId: string
}): Promise<number | undefined> => {
  const config = await args.config.read({ sessionId: args.sessionId })
  if (config.sandbox.configured === false) return undefined
  if (config.sandbox.provider !== ESandboxProvider.Vercel) return undefined
  return await sandboxCumulativeCpuMsOf({
    sandbox: args.sandbox.for(config.sandbox.provider),
    target: { sandboxSessionId: args.sessionId, credentials: config.sandbox.credentials },
  })
}

export const liveSandboxCpuOf = (args: {
  config: Pick<ConfigSource, 'read'>
  sandbox: SandboxProviderRegistry
  now?: (() => number) | undefined
  ttlMs?: number | undefined
}): LiveSandboxCpu => {
  const now = args.now ?? Date.now
  const ttlMs = args.ttlMs ?? LIVE_CPU_TTL_MS
  const readings = new Map<string, CachedReading>()
  const makeRoom = (at: number): void => {
    for (const [sessionId, entry] of readings) {
      if (at - entry.at >= ttlMs) readings.delete(sessionId)
    }
    for (const sessionId of readings.keys()) {
      if (readings.size < CACHE_LIMIT) return
      readings.delete(sessionId)
    }
  }
  return {
    cumulativeCpuMs: async ({ sessionId }) => {
      const at = now()
      const cached = readings.get(sessionId)
      if (cached !== undefined && at - cached.at < ttlMs) return await cached.value
      if (readings.size >= CACHE_LIMIT) makeRoom(at)
      const value = readingOf({
        config: args.config,
        sandbox: args.sandbox,
        sessionId,
      }).catch(() => undefined)
      readings.set(sessionId, { at, value })
      return await value
    },
  }
}

let shared: LiveSandboxCpu | undefined

const sharedLiveCpu = (): LiveSandboxCpu => {
  if (shared !== undefined) return shared
  const env = readAgentHostEnv()
  shared = liveSandboxCpuOf({
    config: configSourceOf({ env, db, cipher: new SecretCipher(env.secretsEncryptionKey) }),
    sandbox: sandboxProvidersOf({ env, db }),
  })
  return shared
}

export const sandboxLiveCpuMs = async (args: {
  sessionId: string
}): Promise<number | undefined> => {
  try {
    return await sharedLiveCpu().cumulativeCpuMs(args)
  } catch {
    return undefined
  }
}
