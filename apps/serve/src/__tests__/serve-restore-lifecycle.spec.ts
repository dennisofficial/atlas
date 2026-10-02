import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'
import { EPortExposure, toRunId, type EnvironmentCapabilities } from '@dltech/atlas-core'

import { EClientFrame, EServeFrame } from '@dltech/atlas-harness'
import { sessionDirectory } from '@dltech/atlas-harness'

import { EWorkspaceState, startServe } from '../index'
import { readTranscriptOrigin } from '../transcript-bootstrap'

import { connect } from './client'
import { fakeServeApp } from './fakes'
import {
  askRestore,
  bootRestoreServe,
  freshRestoreHome,
  readSaid,
  restoreEventFile,
  RESTORE_CONTROL_PLANE,
  RESTORE_THREAD,
  RESTORE_TOKEN,
  runningServes,
  seedArchive,
  settle,
  wireRealLog,
} from './restore-fixture'

const CAPABILITIES: EnvironmentCapabilities = {
  canPush: false,
  gitIdentity: null,
  gpgSigning: false,
  dockerAvailable: false,
  persistentFs: true,
  serviceTtlSeconds: null,
  portExposure: EPortExposure.None,
  failures: [],
}

const LEGACY_BOOT_CAPABILITY_DRAFT = {
  type: 'context-loaded',
  slot: 'session',
  key: 'environment-capabilities',
  content: 'This environment’s probed capabilities:\n- git push/PR/CI from here: no',
} as const

const originIn = (home: string) =>
  readTranscriptOrigin({ sessionDir: sessionDirectory({ home, sessionId: RESTORE_THREAD }) })

describe('the restore-transcript op across a serve’s life', () => {
  it('restores the archive the lift uploaded after a profiled boot', async () => {
    const home = freshRestoreHome()
    let uploaded: Uint8Array | null = null
    const app = fakeServeApp({ threadId: RESTORE_THREAD, root: '/workspace' })
    wireRealLog({ home, app })

    const { client } = await bootRestoreServe({
      home,
      archive: async () => uploaded,
      app,
      capabilities: CAPABILITIES,
    })
    expect(await readSaid(client, 'read-before')).toEqual([])
    expect((await originIn(home))?.archiveDigest).toBeNull()

    uploaded = await seedArchive({ texts: ['lifted-from-the-mac'] })
    const reply = await askRestore(client, 'restore-1')
    expect(reply).toEqual({ ok: true, restored: true, message: null })

    const said = await readSaid(client, 'read-after')
    expect(said.map((event) => event.text)).toEqual(['lifted-from-the-mac'])
    expect(said[0]?.id).toBe('src-event-1')
    expect((await originIn(home))?.archiveDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('never stamps the origin over a boot-preserved legacy log', async () => {
    const home = freshRestoreHome()
    const seeded = wireRealLog({ home, app: fakeServeApp({ threadId: RESTORE_THREAD, root: '/workspace' }) })
    await seeded.log.append({
      threadId: RESTORE_THREAD,
      runId: toRunId('boot-notice'),
      drafts: [LEGACY_BOOT_CAPABILITY_DRAFT],
    })
    const archive = await seedArchive({ texts: ['one'] })
    const app = fakeServeApp({ threadId: RESTORE_THREAD, root: '/workspace' })
    wireRealLog({ home, app })

    await bootRestoreServe({ home, archive: async () => archive, app, capabilities: CAPABILITIES })
    expect(existsSync(restoreEventFile(home))).toBe(true)
    expect(await originIn(home)).toBeNull()
  })

  it('a profiled boot appends no capability context to the real log', async () => {
    const home = freshRestoreHome()
    const app = fakeServeApp({ threadId: RESTORE_THREAD, root: '/workspace' })
    const store = wireRealLog({ home, app })

    await bootRestoreServe({ home, archive: async () => null, app, capabilities: CAPABILITIES })

    const events = await store.log.read({ threadId: RESTORE_THREAD })
    expect(events.filter((event) => event.type === 'context-loaded')).toEqual([])
    expect(existsSync(restoreEventFile(home))).toBe(false)
  })

  it('keeps a cloud append across a reconnect and a restart against the same uploaded tar', async () => {
    const home = freshRestoreHome()
    let uploaded: Uint8Array | null = null
    const firstApp = fakeServeApp({ threadId: RESTORE_THREAD, root: '/workspace' })
    const firstStores = wireRealLog({ home, app: firstApp })

    const first = await bootRestoreServe({ home, archive: async () => uploaded, app: firstApp })
    uploaded = await seedArchive({ texts: ['from-the-mac'] })
    await askRestore(first.client, 'restore-1')

    await firstStores.log.append({
      threadId: RESTORE_THREAD,
      runId: toRunId('cloud-run'),
      drafts: [{ type: 'user-said', text: 'said-in-the-cloud' }],
    })

    const reconnected = await connect({ port: first.handle.port, token: RESTORE_TOKEN })
    reconnected.send({
      kind: EClientFrame.Hello,
      threadId: RESTORE_THREAD,
      channelCursor: null,
      lastEventSeq: 0,
    })
    await reconnected.waitFor((frame) => frame.kind === EServeFrame.Ready)
    expect((await readSaid(reconnected, 'read-reconnect')).map((event) => event.text)).toEqual([
      'from-the-mac',
      'said-in-the-cloud',
    ])
    reconnected.close()
    await first.handle.close()
    runningServes.pop()

    const secondApp = fakeServeApp({ threadId: RESTORE_THREAD, root: '/workspace' })
    wireRealLog({ home, app: secondApp })
    const second = await bootRestoreServe({ home, archive: async () => uploaded, app: secondApp })
    expect((await readSaid(second.client, 'read-restart')).map((event) => event.text)).toEqual([
      'from-the-mac',
      'said-in-the-cloud',
    ])
  })

  it('re-adopts children only when the restore applies a new generation', async () => {
    const home = freshRestoreHome()
    let archive = await seedArchive({ texts: ['one'] })
    const app = fakeServeApp({ threadId: RESTORE_THREAD, root: '/workspace' })
    wireRealLog({ home, app })

    const { client } = await bootRestoreServe({ home, archive: async () => archive, app })
    expect(app.adoptions()).toEqual([RESTORE_THREAD])

    const matched = await askRestore(client, 'restore-same')
    expect(matched.ok).toBe(true)
    expect(app.adoptions()).toEqual([RESTORE_THREAD])

    archive = await seedArchive({ texts: ['one', 'two'] })
    const updated = await askRestore(client, 'restore-new')
    expect(updated.ok).toBe(true)
    await settle()
    expect(app.adoptions()).toEqual([RESTORE_THREAD, RESTORE_THREAD])
  })

  it('a failed boot materialize refuses startup rather than composing a blank session', async () => {
    const home = freshRestoreHome()

    await expect(
      startServe({
        threadId: RESTORE_THREAD,
        port: 0,
        token: RESTORE_TOKEN,
        controlPlaneUrl: RESTORE_CONTROL_PLANE,
        env: {},
        cwd: '/workspace',
        compose: async () => fakeServeApp({ threadId: RESTORE_THREAD, root: '/workspace' }),
        ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
        fetchTranscriptArchive: async () => {
          throw new Error('the drive detached mid-boot')
        },
        fetchFn: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow('the transcript could not be restored at boot')
    expect(existsSync(restoreEventFile(home))).toBe(false)
  })

  it('a fresh cloud-first boot stamps the origin and materializes the session meta', async () => {
    const home = freshRestoreHome()
    const app = fakeServeApp({ threadId: RESTORE_THREAD, root: '/workspace' })
    wireRealLog({ home, app })

    await bootRestoreServe({ home, archive: async () => null, app })

    const origin = await originIn(home)
    expect(origin).toEqual({ threadId: RESTORE_THREAD, archiveDigest: null, initialized: true })
    expect(
      existsSync(
        join(sessionDirectory({ home, sessionId: RESTORE_THREAD }), 'threads', `${RESTORE_THREAD}.meta.json`),
      ),
    ).toBe(true)
  })
})
