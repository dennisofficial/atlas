import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EAccountOrigin, EAuthKind, EAuthProvider } from '@dltech/atlas-core'

import { fileAccountStore, type AccountStore } from '../account-store'

const CHILD = join(import.meta.dir, 'cross-process-child.ts')
const POLL_MS = 10
const WAIT_MS = 20_000

type ChildJob = {
  mode: 'hold' | 'add' | 'refresh' | 'handoff'
  name: string
  accountId?: string
  blockOn?: string
  signal?: string
}

export type Child = { name: string; finished: Promise<void> }

export type Arena = {
  dir: string
  store: AccountStore
  spawn: (job: ChildJob) => Child
  open: (barrier: string) => void
  reached: (barrier: string) => Promise<void>
  events: () => string[]
  close: () => Promise<void>
}

export const openArena = (): Arena => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-cross-process-'))
  const store = fileAccountStore({
    file: join(dir, 'auth.json'),
    keyFile: join(dir, 'key'),
    clock: { now: () => '2026-10-05T12:00:00.000Z' },
  })
  const running: Promise<void>[] = []
  writeFileSync(join(dir, 'events.log'), '')

  const spawn = (job: ChildJob): Child => {
    const proc = Bun.spawn([process.execPath, CHILD, JSON.stringify({ ...job, dir })], {
      stdout: 'ignore',
      stderr: 'pipe',
      env: { ...process.env, ATLAS_TESTING: '1' },
    })
    const finished = (async () => {
      const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
      if (code !== 0) throw new Error(`child ${job.name} exited ${code}: ${stderr.slice(0, 600)}`)
    })()
    finished.catch(() => undefined)
    running.push(finished)

    return { name: job.name, finished }
  }

  const reached = async (barrier: string): Promise<void> => {
    const deadline = Date.now() + WAIT_MS
    while (!existsSync(join(dir, barrier))) {
      if (Date.now() > deadline) throw new Error(`barrier ${barrier} never reached`)
      await new Promise((done) => setTimeout(done, POLL_MS))
    }
  }

  return {
    dir,
    store,
    spawn,
    open: (barrier) => appendFileSync(join(dir, barrier), ''),
    reached,
    events: () => readFileSync(join(dir, 'events.log'), 'utf8').split('\n').filter((line) => line !== ''),
    close: async () => {
      await Promise.allSettled(running)
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

export const seedExpiredGrant = (arena: Arena) =>
  arena.store.add({
    provider: EAuthProvider.Anthropic,
    label: 'native',
    origin: EAccountOrigin.Login,
    secret: {
      kind: EAuthKind.Oauth,
      tokens: { accessToken: 'fake-old', refreshToken: 'fake-seed-refresh', expiresAt: '2026-10-05T11:00:00.000Z' },
    },
  })
