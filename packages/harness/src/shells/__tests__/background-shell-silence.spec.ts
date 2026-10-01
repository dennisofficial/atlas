import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus } from '@dltech/atlas-core'

import { HookChain } from '../../hooks/registry'
import { RandomIds, SystemClock } from '../../store'
import { BunShellRegistry } from '../shell-registry'
import { endedDraft, job, RecordingLog, recorded, settle, THREAD } from './shell-registry-fixture'

const SILENCE_MS = 400

const silentRegistry = ({ root }: { root: string }) => {
  const log = new RecordingLog()
  const registry = new BunShellRegistry(
    root,
    new SystemClock(),
    () => new HookChain({}),
    undefined,
    undefined,
    log,
    new RandomIds(),
    SILENCE_MS,
  )
  return { registry, log }
}

describe('a background shell that goes silent', () => {
  it('is killed as a timeout once it prints nothing for the ceiling, so a wait never sits indefinitely', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-shells-silent-'))
    const { registry, log } = silentRegistry({ root })

    const started = registry.start(job({ command: 'sleep 30' }))
    if (!started.ok) throw new Error('the shell did not start')

    await settle({ registry, shellId: started.snapshot.shellId })
    await recorded({ log })

    expect(endedDraft(log.appended[0])).toMatchObject({
      status: EShellStatus.Killed,
      killedBy: EKilledBy.Timeout,
    })

    await registry.closeAll()
    fs.rmSync(root, { recursive: true, force: true })
  }, 15_000)

  it('leaves a chatty shell alone: output re-arms the clock', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-shells-chatty-'))
    const { registry, log } = silentRegistry({ root })

    const started = registry.start(
      job({ command: 'echo first && sleep 0.2 && echo second && sleep 0.2 && echo third' }),
    )
    if (!started.ok) throw new Error('the shell did not start')

    await settle({ registry, shellId: started.snapshot.shellId })
    await recorded({ log })

    const ended = endedDraft(log.appended[0])
    expect(ended.status).toBe(EShellStatus.Exited)
    expect(ended.exitCode).toBe(0)

    await registry.closeAll()
    fs.rmSync(root, { recursive: true, force: true })
  }, 15_000)
})
