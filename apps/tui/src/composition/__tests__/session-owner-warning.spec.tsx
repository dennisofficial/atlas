import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, EHarnessPlacement, EPlacementMovePhase } from '@dltech/atlas-core'
import { EClientRequest, ERuntimeKind, RemoteTurnRunner } from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { currentNotices, dismissNotice, ENoticeTone } from '../../ui/notice-store'
import { fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import { until } from './app-fixture'
import { activatingAs, mountCloud } from './app-cloud-archive-fixture'
import { speaking } from './app-container-cloud-fixture'

await grammarsReady()

afterEach(() => {
  dismissNotice()
})

const WARNING =
  'this conversation is in the cloud, but the prepared cloud runtime could not be activated after ownership committed'

const warnings = () => currentNotices().filter((notice) => notice.key === 'container-cloud')

const lifted = async (args: { replies: readonly boolean[] }) => {
  const app = speaking()
  const bridge: FakeBridge = fakeBridge()
  const seen = activatingAs({ bridge, cwd: app.workspace.workspace, replies: args.replies })
  const mounted = await mountCloud({ app, bridge, withArchive: true })
  await mounted.command('/container cloud')
  expect(await until({ holds: async () => bridge.attached.length === 1, within: 20_000 })).toBe(true)
  return { app, bridge, mounted, seen }
}

describe('a lift whose cloud runtime answers activated: false after ownership committed', () => {
  it('keeps the committed cloud binding and says so on screen instead of reporting a failed move', async () => {
    const { app, bridge, mounted, seen } = await lifted({ replies: [false] })

    try {
      const frame = await mounted.showing('could not be activated')
      expect(seen).toContain(EClientRequest.ApplyWorkspaceArchive)
      expect(seen.filter((op) => op === EClientRequest.ActivateSession)).toHaveLength(1)
      expect(frame).toContain('this conversation is in the cloud, but')
      expect(frame).not.toContain('moving to the cloud failed')
      expect(frame).not.toContain('still runs here')
      expect(frame).not.toContain('nothing moved')

      const owner = app.sessionOwner.snapshot()
      expect(owner.location).toBe(EExecutionLocation.Cloud)
      expect(owner.bound).toBe(true)
      expect(owner.binding?.kind).toBe(ERuntimeKind.Cloud)
      expect(owner.binding?.adapters.channel).toBe(bridge.channel)
      expect(owner.binding?.adapters.runner).not.toBe(app.runner)
      expect(owner.binding?.adapters.runner).toBeInstanceOf(RemoteTurnRunner)
      expect(owner.record?.placement.harness).toBe(EHarnessPlacement.Cloud)
      expect(owner.record?.move?.phase).toBe(EPlacementMovePhase.Committed)
      expect(app.executionLocation.current()).toBe(EExecutionLocation.Cloud)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('holds the warning as one sticky warn notice that outlives the move overlay', async () => {
    const { mounted } = await lifted({ replies: [false] })

    try {
      await mounted.showing('could not be activated')
      expect(warnings()).toHaveLength(1)
      expect(warnings()[0]?.text).toBe(WARNING)
      expect(warnings()[0]?.tone).toBe(ENoticeTone.Warn)
      expect(warnings()[0]?.ttlMs).toBeNull()

      const frame = await mounted.frame()
      expect(frame).not.toContain('MOVING TO THE CLOUD')
      expect(warnings()).toHaveLength(1)
      expect(frame).toContain('could not be activated')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('binds the cloud runtime with no local fallback and leaves the committed move for recovery to retry', async () => {
    const { app, bridge, mounted, seen } = await lifted({ replies: [false] })

    try {
      await mounted.showing('could not be activated')
      const owner = app.sessionOwner.snapshot()
      expect(owner.bound).toBe(true)
      expect(owner.binding?.kind).toBe(ERuntimeKind.Cloud)
      expect(owner.binding?.adapters.runner).toBeInstanceOf(RemoteTurnRunner)
      expect(owner.binding?.adapters.channel).toBe(bridge.channel)
      expect(owner.record?.move?.phase).toBe(EPlacementMovePhase.Committed)
      expect(app.executionLocation.current()).toBe(EExecutionLocation.Cloud)
      expect(seen.filter((op) => op === EClientRequest.ActivateSession)).toHaveLength(1)
      expect(currentNotices().map((notice) => notice.text).join('\n')).not.toContain('failed')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('recovers the unfinished move on /container off when activation succeeds the second time, then descends when asked again', async () => {
    const { app, bridge, mounted, seen } = await lifted({ replies: [false, true] })

    try {
      await mounted.showing('could not be activated')
      await mounted.command('/container off')
      await mounted.showing('recovering it first')
      expect(await until({ holds: async () => app.sessionOwner.snapshot().record?.move === null, within: 20_000 })).toBe(true)
      expect(seen.filter((op) => op === EClientRequest.ActivateSession)).toHaveLength(2)
      expect(app.sessionOwner.snapshot().location).toBe(EExecutionLocation.Cloud)
      expect(app.sessionOwner.snapshot().bound).toBe(true)
      expect(bridge.destroyed).toEqual([])

      await mounted.command('/container off')
      expect(await until({ holds: async () => app.sessionOwner.snapshot().location === EExecutionLocation.Host, within: 20_000 })).toBe(true)
      expect(app.sessionOwner.snapshot().binding?.kind).toBe(ERuntimeKind.Local)
      expect(app.sessionOwner.snapshot().record?.move).toBeNull()
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('keeps the source in the cloud and the move unfinished when activation is refused every time, retrying on each ask', async () => {
    const { app, mounted, seen } = await lifted({ replies: [false] })

    try {
      await mounted.showing('could not be activated')
      for (const attempt of [2, 3]) {
        await mounted.command('/container off')
        expect(
          await until({
            holds: async () => seen.filter((op) => op === EClientRequest.ActivateSession).length === attempt,
            within: 20_000,
          }),
        ).toBe(true)
        expect(
          await until({
            holds: async () => currentNotices().some((notice) => notice.text.includes('could not be recovered yet')),
            within: 20_000,
          }),
        ).toBe(true)
        dismissNotice('container-switch')
        const owner = app.sessionOwner.snapshot()
        expect(owner.location).toBe(EExecutionLocation.Cloud)
        expect(owner.binding?.kind).toBe(ERuntimeKind.Cloud)
        expect(owner.record?.move?.phase).toBe(EPlacementMovePhase.Committed)
      }
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('stays silent when the runtime activates', async () => {
    const { app, mounted, seen } = await lifted({ replies: [true] })

    try {
      await mounted.showing('☁ cloud')
      expect(seen.filter((op) => op === EClientRequest.ActivateSession)).toHaveLength(1)
      expect(warnings()).toHaveLength(0)
      expect(app.sessionOwner.snapshot().binding?.kind).toBe(ERuntimeKind.Cloud)
      expect(await mounted.frame()).not.toContain('could not be activated')
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
