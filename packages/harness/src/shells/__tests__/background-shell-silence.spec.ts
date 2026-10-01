import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus, toThreadId } from '@dltech/atlas-core'

import { LocalProcessPort } from '../../execution/local-process'
import { HookChain } from '../../hooks/registry'
import { SystemClock } from '../../store'
import { BunShellRegistry } from '../shell-registry'
import { endedDraft, job, settle } from './shell-registry-fixture'

const THREAD = toThreadId('thread-under-test')

const SILENCE_MS = 400

describe('a background shell that goes silent', () => {
  it('is killed as a timeout once it prints nothing for the ceiling, so a wait never sits indefinitely', async () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-shells-silent-'))
    const registry = new BunShellRegistry(
      root,
      new SystemClock(),
      () => new HookChain({}),
      new LocalProcessPort(),
      undefined,
      SILENCE_MS,
    )

    const started = registry.start(job({ command: 'sleep 30' }))
    if (!started.ok) throw new Error('the shell did not start')

    await settle({ registry, shellId: started.snapshot.shellId })

    expect(endedDraft(registry.drainNotifications({ threadId: THREAD })[0])).toMatchObject({
      status: EShellStatus.Killed,
      killedBy: EKilledBy.Timeout,
    })

    await registry.closeAll()
    rmSync(root, { recursive: true, force: true })
  }, 15_000)

  it('leaves a chatty shell alone: output re-arms the clock', async () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-shells-chatty-'))
    const registry = new BunShellRegistry(
      root,
      new SystemClock(),
      () => new HookChain({}),
      new LocalProcessPort(),
      undefined,
      SILENCE_MS,
    )

    const started = registry.start(
      job({ command: 'echo first && sleep 0.2 && echo second && sleep 0.2 && echo third' }),
    )
    if (!started.ok) throw new Error('the shell did not start')

    await settle({ registry, shellId: started.snapshot.shellId })

    const ended = endedDraft(registry.drainNotifications({ threadId: THREAD })[0])
    expect(ended.status).toBe(EShellStatus.Exited)
    expect(ended.exitCode).toBe(0)

    await registry.closeAll()
    rmSync(root, { recursive: true, force: true })
  }, 15_000)
})
