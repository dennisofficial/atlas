import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import {
  TRANSCRIPT_ARCHIVE_PATH,
  WORKSPACE_ARCHIVE_PATH,
  type BridgeDriver,
  type LiveSandbox,
} from '../local-cloud-bootstrap'
import { createLocalCloudBridge } from '../local-cloud-bridge'
import { ECloudSandboxState } from '../sandbox-client'
import type { SandboxPlacement, VercelSandboxConfig } from '@dltech/atlas-wire'

const threadId = toThreadId('thread-concurrency')

const config: VercelSandboxConfig = {
  credentials: { token: 'vt', teamId: 'team', projectId: 'proj' },
  image: 'atlas-sandbox:test',
}

const deferred = () => {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flushMicrotasks = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

const gatedHarness = () => {
  const events: string[] = []
  const gates = {
    [TRANSCRIPT_ARCHIVE_PATH]: deferred(),
    [WORKSPACE_ARCHIVE_PATH]: deferred(),
  }
  const started = {
    [TRANSCRIPT_ARCHIVE_PATH]: deferred(),
    [WORKSPACE_ARCHIVE_PATH]: deferred(),
  }
  const gateOf = (destination: string) => {
    const gate = gates[destination as keyof typeof gates]
    const start = started[destination as keyof typeof started]
    if (gate === undefined || start === undefined) throw new Error(`unexpected upload ${destination}`)
    return { gate, start }
  }
  const driver: BridgeDriver = {
    inspect: async () => undefined,
    createOrResume: async (createArgs) => {
      events.push('create')
      try {
        await createArgs.putContextOnFreshBoot?.({} as LiveSandbox)
      } catch (error) {
        events.push('bootstrap-failed')
        throw error
      }
      events.push('launch')
      const placement: SandboxPlacement = {
        sessionId: 'session-1',
        url: 'https://sb.vercel.run',
        state: ECloudSandboxState.Running,
        created: true,
        driveName: 'drive-1',
        token: 'tok',
      }
      return placement
    },
    writeBootstrapFileToSandbox: async () => {},
    writeBootstrapFile: async () => {},
    uploadWorkspaceArchive: async (upload) => {
      const { gate, start } = gateOf(upload.destination)
      events.push(`start:${upload.destination}`)
      start.resolve()
      try {
        await gate.promise
      } catch (error) {
        events.push(`fail:${upload.destination}`)
        throw error
      }
      events.push(`finish:${upload.destination}`)
    },
    downloadWorkspaceArchive: async () => {},
    releaseWorkspaceArchive: async () => {},
    downloadSessionArchive: async () => {},
    releaseSessionArchive: async () => {},
    transcriptLanded: async () => true,
    destroy: async () => {},
  }
  const bridge = createLocalCloudBridge({
    vercel: () => config,
    attachmentToken: () => 'tok',
    driverWith: () => driver,
  })
  const create = () =>
    bridge.sandboxes.create({
      threadId,
      workspace: null,
      transcriptArchivePath: '/tmp/local/transcript.tar.gz',
      workspaceArchivePath: '/tmp/local/workspace.tar.gz',
    })
  const bothStarted = () =>
    Promise.all([
      started[TRANSCRIPT_ARCHIVE_PATH].promise,
      started[WORKSPACE_ARCHIVE_PATH].promise,
    ])
  return { events, gates, create, bothStarted }
}

describe('createLocalCloudBridge archive upload concurrency', () => {
  it('starts both archive uploads before either finishes', async () => {
    const { events, gates, create, bothStarted } = gatedHarness()

    const placement = create()
    await bothStarted()

    expect(events).toEqual([
      'create',
      `start:${TRANSCRIPT_ARCHIVE_PATH}`,
      `start:${WORKSPACE_ARCHIVE_PATH}`,
    ])

    gates[TRANSCRIPT_ARCHIVE_PATH].resolve()
    gates[WORKSPACE_ARCHIVE_PATH].resolve()
    await placement
  })

  it('launches only after the transcript finishes first and the workspace finishes last', async () => {
    const { events, gates, create, bothStarted } = gatedHarness()

    const placement = create()
    await bothStarted()
    gates[TRANSCRIPT_ARCHIVE_PATH].resolve()
    await flushMicrotasks()
    expect(events).toContain(`finish:${TRANSCRIPT_ARCHIVE_PATH}`)
    expect(events).not.toContain('launch')

    gates[WORKSPACE_ARCHIVE_PATH].resolve()
    await placement

    expect(events.indexOf('launch')).toBeGreaterThan(events.indexOf(`finish:${WORKSPACE_ARCHIVE_PATH}`))
    expect(events.indexOf('launch')).toBeGreaterThan(events.indexOf(`finish:${TRANSCRIPT_ARCHIVE_PATH}`))
  })

  it('launches only after the workspace finishes first and the transcript finishes last', async () => {
    const { events, gates, create, bothStarted } = gatedHarness()

    const placement = create()
    await bothStarted()
    gates[WORKSPACE_ARCHIVE_PATH].resolve()
    await flushMicrotasks()
    expect(events).toContain(`finish:${WORKSPACE_ARCHIVE_PATH}`)
    expect(events).not.toContain('launch')

    gates[TRANSCRIPT_ARCHIVE_PATH].resolve()
    await placement

    expect(events.indexOf('launch')).toBeGreaterThan(events.indexOf(`finish:${WORKSPACE_ARCHIVE_PATH}`))
    expect(events.indexOf('launch')).toBeGreaterThan(events.indexOf(`finish:${TRANSCRIPT_ARCHIVE_PATH}`))
  })

  it('holds a transcript failure until the blocked workspace upload settles and never launches', async () => {
    const { events, gates, create, bothStarted } = gatedHarness()

    const placement = create()
    const outcome = placement.then(() => undefined, (error: unknown) => error)
    await bothStarted()
    gates[TRANSCRIPT_ARCHIVE_PATH].reject(new Error('transcript rejected'))
    await flushMicrotasks()
    expect(events).toContain(`fail:${TRANSCRIPT_ARCHIVE_PATH}`)
    expect(events).not.toContain('bootstrap-failed')

    gates[WORKSPACE_ARCHIVE_PATH].resolve()
    expect(String(await outcome)).toContain('transcript rejected')

    expect(events.indexOf('bootstrap-failed')).toBeGreaterThan(events.indexOf(`finish:${WORKSPACE_ARCHIVE_PATH}`))
    expect(events).not.toContain('launch')
  })

  it('holds a workspace failure until the blocked transcript upload settles and never launches', async () => {
    const { events, gates, create, bothStarted } = gatedHarness()

    const placement = create()
    const outcome = placement.then(() => undefined, (error: unknown) => error)
    await bothStarted()
    gates[WORKSPACE_ARCHIVE_PATH].reject(new Error('workspace rejected'))
    await flushMicrotasks()
    expect(events).toContain(`fail:${WORKSPACE_ARCHIVE_PATH}`)
    expect(events).not.toContain('bootstrap-failed')

    gates[TRANSCRIPT_ARCHIVE_PATH].resolve()
    expect(String(await outcome)).toContain('workspace rejected')

    expect(events.indexOf('bootstrap-failed')).toBeGreaterThan(events.indexOf(`finish:${TRANSCRIPT_ARCHIVE_PATH}`))
    expect(events).not.toContain('launch')
  })
})
