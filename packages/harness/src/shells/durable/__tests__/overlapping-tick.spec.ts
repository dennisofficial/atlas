import { afterEach, describe, expect, setSystemTime, spyOn, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EExitCause, type LaunchSpec } from '../client'
import * as exitRecord from '../exit-record'
import * as identity from '../identity'
import { runShellSupervisor } from '../supervisor'
import { launchOrThrow } from './fixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  setSystemTime()
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'durable-tick-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function readExit({ shellDir }: { shellDir: string }) {
  const status = JSON.parse(await Bun.file(join(shellDir, 'status.json')).text()) as {
    exit?: { cause: string; exitCode: number }
  }
  return status.exit
}

async function waitForExit({ shellDir }: { shellDir: string }) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const exit = await readExit({ shellDir })
    if (exit !== undefined) return exit
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return undefined
}

function superviseInProcess({ spec }: { spec: LaunchSpec }): Promise<number> {
  const configPath = spec.cmd.at(-1)
  if (configPath === undefined) throw new Error('launch spec carries no config path')
  return runShellSupervisor([configPath])
}

describe('overlapping tick lifecycle', () => {
  test('a natural exit during a slow tick keeps its natural cause', async () => {
    const root = await scratch()
    const shellDir = join(root, 'shell')
    const gate = join(root, 'gate')
    const tickEntered = deferred<void>()
    const releaseTick = deferred<boolean>()
    const lockCheck = spyOn(identity, 'lockClaimIsActive').mockImplementation(() => {
      tickEntered.resolve()
      return releaseTick.promise
    })
    const drain = spyOn(exitRecord, 'groupDrained').mockImplementation(async () => {
      releaseTick.resolve(true)
      await Bun.sleep(100)
    })
    cleanups.push(async () => {
      lockCheck.mockRestore()
      drain.mockRestore()
    })

    let supervisor: Promise<number> = Promise.resolve(-1)
    const handle = await launchOrThrow({
      shellDir,
      timeoutMs: 60_000,
      tickMs: 30,
      command: `while [ ! -f '${gate}' ]; do sleep 0.01; done; exit 0`,
      sessionLock: { lockFile: join(root, 'lock') },
      launch: async (spec) => {
        supervisor = superviseInProcess({ spec })
      },
    })

    await tickEntered.promise
    setSystemTime(new Date(Date.now() + 120_000))
    await writeFile(gate, '')
    const exit = await waitForExit({ shellDir })
    expect(exit?.cause).toBe(EExitCause.Natural)
    expect(exit?.exitCode).toBe(0)

    await handle.detach()
    expect(await supervisor).toBe(0)
    expect((await readExit({ shellDir }))?.cause).toBe(EExitCause.Natural)
  })
})
