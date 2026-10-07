import { describe, expect, it } from 'bun:test'

import { ENoticeTone } from '@dltech/atlas-core'

import { EClientRequest } from '../../channel-wire'
import { cloudArchiveOf, descend, fakeSurface, useDescendHome } from './descend-fixture'
import {
  FAMILY_RESTORED,
  GENERATION,
  SOURCE_SESSION,
  familyCleanupSetup,
  type FamilyCleanupSetup,
} from './family-cleanup-fixture'
import { CLOUD_THREAD } from './fixture'
import { fakeRestorer } from './workspace-fixture'

const said = (text: string) => ({ type: 'user-said' as const, text })
const NOTICE_KEY = 'descend-sandbox-destroy-failed'

const run = async (args: Omit<Parameters<typeof familyCleanupSetup>[0], 'archive'> & { restorer?: ReturnType<typeof fakeRestorer> }) => {
  const home = useDescendHome()
  const setup = familyCleanupSetup({ ...args, archive: await cloudArchiveOf([{ drafts: [said('family')] }]) })
  const restorer = args.restorer ?? fakeRestorer({ result: FAMILY_RESTORED, transactional: true })
  const surface = fakeSurface()
  const opened = await descend({ home, bridge: setup.bridge, channel: setup.channel, surface, restoreWorkspace: restorer.restore })
  return { setup, restorer, surface, opened }
}

const warning = (surface: ReturnType<typeof fakeSurface>) => surface.notices.posts.find((post) => post.key === NOTICE_KEY)

const confirmationsOf = (setup: FamilyCleanupSetup) =>
  setup.confirmations.map((params) => ({ op: EClientRequest.ConfirmWorkspaceCleanup, params }))

describe('descend with a family source cleanup candidate', () => {
  it('retains the source and warns when the candidate is unsafe, after the host arrival committed', async () => {
    const { setup, restorer, surface, opened } = await run({
      candidate: { safe: false, reasons: ['unrelated-checkout: /srv/other'] },
    })

    expect(opened.threadId).toBe(CLOUD_THREAD)
    expect(restorer.commits).toBe(1)
    expect(restorer.rollbacks).toBe(0)
    expect(setup.destroyCalls).toEqual([])
    expect(confirmationsOf(setup)).toEqual([])
    expect(warning(surface)?.tone).toBe(ENoticeTone.Warn)
    expect(warning(surface)?.ttlMs).toBeNull()
    expect(warning(surface)?.text).toContain('unrelated-checkout: /srv/other')
  })

  it('retains the source when a safe candidate carries no source session identity', async () => {
    const { setup, surface } = await run({ candidate: { safe: true, reasons: [] }, confirm: { safe: true, reasons: [], sourceSessionId: '' } })

    expect(setup.destroyCalls).toEqual([])
    expect(warning(surface)?.tone).toBe(ENoticeTone.Warn)
  })

  it('retains the source when a family arrival carries no cleanup candidate at all', async () => {
    const { setup, surface } = await run({})

    expect(setup.destroyCalls).toEqual([])
    expect(confirmationsOf(setup)).toEqual([])
    expect(warning(surface)?.text).toContain('no source cleanup proof')
  })

  it('retains the source when the late recheck turns false after a true candidate', async () => {
    const { setup, surface, restorer } = await run({
      candidate: { safe: true, reasons: [] },
      confirm: { safe: false, reasons: ['registry-changed: /srv/late'], sourceSessionId: SOURCE_SESSION },
    })

    expect(restorer.commits).toBe(1)
    expect(confirmationsOf(setup)).toEqual([{ op: EClientRequest.ConfirmWorkspaceCleanup, params: { generation: GENERATION } }])
    expect(setup.destroyCalls).toEqual([])
    expect(warning(surface)?.text).toContain('registry-changed: /srv/late')
  })

  it('retains the source when the confirmed session is not the exported one', async () => {
    const { setup, surface } = await run({
      candidate: { safe: true, reasons: [] },
      confirm: { safe: true, reasons: [], sourceSessionId: 'session-replacement' },
    })

    expect(setup.destroyCalls).toEqual([])
    expect(warning(surface)?.text).toContain('provider session changed')
  })

  it('keeps the host authoritative and the source retained when the recheck throws', async () => {
    const { setup, surface, opened, restorer } = await run({
      candidate: { safe: true, reasons: [] },
      confirm: new Error('the recheck could not read the source'),
    })

    expect(opened.threadId).toBe(CLOUD_THREAD)
    expect(restorer.commits).toBe(1)
    expect(restorer.rollbacks).toBe(0)
    expect(setup.destroyCalls).toEqual([])
    expect(warning(surface)?.tone).toBe(ENoticeTone.Warn)
    expect(warning(surface)?.text).toContain('the recheck could not read the source')
  })

  it('destroys exactly once, fenced to the exported source session, when the proof still holds', async () => {
    const { setup, surface } = await run({ candidate: { safe: true, reasons: [] } })

    expect(confirmationsOf(setup)).toHaveLength(1)
    expect(setup.destroyCalls).toEqual([{ threadId: CLOUD_THREAD, expectedSandboxSessionId: SOURCE_SESSION }])
    expect(warning(surface)).toBeUndefined()
  })

  it('warns and never retries when the fenced destroy is refused', async () => {
    const { setup, surface } = await run({
      candidate: { safe: true, reasons: [] },
      destroyFails: new Error('refusing to stop sandbox x: its live session is not the expected one'),
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 20))

    expect(setup.destroyCalls).toHaveLength(1)
    expect(warning(surface)?.tone).toBe(ENoticeTone.Warn)
    expect(warning(surface)?.ttlMs).toBeNull()
    expect(warning(surface)?.text).toContain('refusing to stop sandbox x')
  })
})

describe('descend integrity and the legacy teardown', () => {
  it('fails before restore, and never touches the source, when the archive checksum does not match', async () => {
    const home = useDescendHome()
    const setup = familyCleanupSetup({
      archive: await cloudArchiveOf([{ drafts: [said('family')] }]),
      candidate: { safe: true, reasons: [] },
      sha256: 'f'.repeat(64),
    })
    const restorer = fakeRestorer({ result: FAMILY_RESTORED, transactional: true })

    await expect(
      descend({ home, bridge: setup.bridge, channel: setup.channel, restoreWorkspace: restorer.restore }),
    ).rejects.toThrow('did not match its source digest')

    expect(restorer.calls).toEqual([])
    expect(restorer.commits).toBe(0)
    expect(setup.destroyCalls).toEqual([])
    expect(confirmationsOf(setup)).toEqual([])
  })

  it('keeps the unfenced destroy for a legacy restore that carries no family result', async () => {
    const { setup } = await run({ restorer: fakeRestorer() })

    expect(setup.destroyCalls).toEqual([{ threadId: CLOUD_THREAD }])
    expect(confirmationsOf(setup)).toEqual([])
  })
})
