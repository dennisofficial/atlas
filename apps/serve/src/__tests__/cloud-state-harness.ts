import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ClockPort } from '@dltech/atlas-core'
import { fileAccountStore, FileSecretsStore, SecretCipher } from '@dltech/atlas-harness'

import { applyCloudState } from '../cloud-state'
import type { ServeLogLine } from '../serve-log'
import { SERVE_TOKEN, startFakeCloud, type FakeCloud, type FakeCloudState } from './cloud-state-fixture'

export const clock: ClockPort = { now: () => '2026-10-20T00:00:00.000Z' }
const homes: string[] = []
const clouds: FakeCloud[] = []

export const tempHome = (): string => {
  homes.push(mkdtempSync(join(tmpdir(), 'atlas-cloud-state-')))
  return homes[homes.length - 1] ?? ''
}

export const cloudWith = (state: Partial<FakeCloudState>): FakeCloud => {
  const cloud = startFakeCloud({
    lease: { accounts: [], active: [] },
    settings: [],
    secrets: [],
    ...state,
  })
  clouds.push(cloud)
  return cloud
}

export const apply = async (args: {
  home: string
  cloud: FakeCloud
  token?: string
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  retryBudgetMs?: number
}): Promise<ServeLogLine[]> => {
  const lines: ServeLogLine[] = []
  await applyCloudState({
    atlasHome: args.home,
    controlPlaneUrl: args.cloud.url,
    token: args.token ?? SERVE_TOKEN,
    clientVersion: '0.0.0-test',
    fetchFn: fetch,
    log: (line) => lines.push(line),
    sleep: args.sleep ?? (async () => undefined),
    ...(args.now === undefined ? {} : { now: args.now }),
    ...(args.retryBudgetMs === undefined ? {} : { retryBudgetMs: args.retryBudgetMs }),
  })
  return lines
}

export const secretsAt = (home: string) =>
  new FileSecretsStore({ file: join(home, 'secrets.json'), cipher: new SecretCipher(join(home, 'key')) })

export const accountStoreAt = (home: string) => fileAccountStore({ file: join(home, 'auth.json'), keyFile: join(home, 'key'), clock })

export const cleanupCloudState = async (): Promise<void> => {
  for (const cloud of clouds.splice(0)) await cloud.stop()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
}
