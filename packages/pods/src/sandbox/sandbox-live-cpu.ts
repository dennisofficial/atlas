import { db } from '@dltech/atlas-db'
import { ESandboxProvider } from '@dltech/atlas-protocol'

import type { SandboxConfigSource } from '../config/sandbox-config'
import { sandboxConfigSourceOf } from '../config/sandbox-config'
import { readPodsEnv } from '../env'
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
  config: SandboxConfigSource
  sandbox: SandboxProviderRegistry
  sessionId: string
}): Promise<number | undefined> => {
  const config = await args.config.read({ sessionId: args.sessionId })
  if (config.configured === false) return undefined
  if (config.provider !== ESandboxProvider.Vercel) return undefined
  return await sandboxCumulativeCpuMsOf({
    sandbox: args.sandbox.for(config.provider),
    target: { sandboxSessionId: args.sessionId, credentials: config.credentials },
  })
}

export const liveSandboxCpuOf = (args: {
  config: SandboxConfigSource
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
  const env = readPodsEnv()
  shared = liveSandboxCpuOf({
    config: sandboxConfigSourceOf({ env, db }),
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
