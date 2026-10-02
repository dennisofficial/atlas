import { describe, expect, it } from 'bun:test'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { testRender } from '@opentui/react/test-utils'
import React from 'react'

import { EChannelConnection } from '@dltech/atlas-harness'
import type { ReleaseRangeDecision } from '@dltech/atlas-core'

import { EBuildKind } from '../../build/info'
import type { ReleaseNotesFetch } from '../../build/release-notes'
import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { CLEAN_WORKSPACE, fakeBridge } from '../cloud/__tests__/fixture'
import type { WhatsNewDeps } from '../use-whats-new'
import { promiseGate, spokenIn, until } from './app-fixture'
import { fakeApp, scriptedModelPort } from './fake-app'
import { FakeSessionDisk } from './fake-session-disk'

await grammarsReady()

const CHANGED: ReleaseRangeDecision = { kind: 'changed', from: '1.28.0', to: '1.32.1' }

const NOTES: ReleaseNotesFetch = {
  kind: 'ok',
  rows: [{ version: '1.32.1', body: 'the notes body for thirty-two' }],
}

const LOADING = 'fetching release notes'
const HEADING = 'since your last launch'

const countingDeps = (args: {
  decision: ReleaseRangeDecision
  claimGate?: Promise<void>
  fetchGate?: Promise<void>
}) => {
  const calls = { claims: 0, fetches: 0 }
  const deps: WhatsNewDeps = {
    build: () => ({ kind: EBuildKind.Release, version: '1.32.1', releaseRepo: 'owner/atlas', buildSha: null }),
    home: () => process.env.ATLAS_HOME ?? '',
    claim: async () => {
      calls.claims += 1
      await args.claimGate
      return args.decision
    },
    fetchNotes: async () => {
      calls.fetches += 1
      await args.fetchGate
      return NOTES
    },
  }
  return { deps, calls }
}

const mount = async (whatsNewDeps: WhatsNewDeps) => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-whats-new-spec-'))
  const previousHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const app = fakeApp({ model: scriptedModelPort({ script: { thinking: 'weighing', reply: 'done' } }) })
  const disk = new FakeSessionDisk(home)
  app.log.mirrorTo(disk)
  app.threads.mirrorTo(disk)
  const bridge = fakeBridge()
  bridge.sourceStores({ log: app.log, threads: app.threads, workspace: app.workspace.workspace, disk })
  const opened = await spokenIn(app)
  await disk.writeSessionMeta({ threadId: opened.threadId })
  await disk.stampProvenance({ threadId: opened.threadId, archiveDigest: null })

  const setup = await testRender(
    <App
      app={app}
      opened={opened}
      createBridge={() => bridge}
      preflightLift={async () => null}
      captureWorkspace={async () => CLEAN_WORKSPACE}
      captureArchive={async () => undefined}
      captureContext={async () => Buffer.from('stub-context-archive')}
      whatsNewDeps={whatsNewDeps}
    />,
    { width: 140, height: 40, exitOnCtrlC: false },
  )

  const frame = async (): Promise<string> => {
    await setup.flush()
    await settle(250)
    await setup.flush()
    return setup.captureCharFrame()
  }

  const showing = (text: string) =>
    until({ holds: async () => (await frame()).includes(text), within: 20_000 })

  return {
    bridge,
    frame,
    showing,
    pressEscape: () => setup.mockInput.pressEscape(),
    lift: async () => {
      await setup.mockInput.typeText('/container cloud')
      setup.mockInput.pressEnter()
      expect(await until({ holds: async () => bridge.attached.length === 1, within: 20_000 })).toBe(true)
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      expect(await showing('CLOUD')).toBe(true)
    },
    reload: () => bridge.channel.reload({ sinceEventSeq: 0 }),
    done: async () => {
      try {
        await teardown(setup)
      } finally {
        if (previousHome === undefined) delete process.env.ATLAS_HOME
        else process.env.ATLAS_HOME = previousHome
        rmSync(home, { recursive: true, force: true })
      }
    },
  }
}

describe('release notes are owned by the app, not the keyed workspace', () => {
  it('claims and fetches once even though a lift and a reload remount the workspace', async () => {
    const claimGate = promiseGate()
    const { deps, calls } = countingDeps({ decision: CHANGED, claimGate: claimGate.gate })
    const mounted = await mount(deps)

    try {
      await mounted.lift()
      claimGate.release()
      expect(await mounted.showing(HEADING)).toBe(true)
      expect(await mounted.showing('the notes body for thirty-two')).toBe(true)

      mounted.reload()
      await settle(500)

      expect(await mounted.frame()).toContain(HEADING)
      expect(calls).toEqual({ claims: 1, fetches: 1 })
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('stays dismissed through later reloads', async () => {
    const { deps, calls } = countingDeps({ decision: CHANGED })
    const mounted = await mount(deps)

    try {
      expect(await mounted.showing(HEADING)).toBe(true)
      mounted.pressEscape()
      expect(await until({ holds: async () => !(await mounted.frame()).includes(HEADING), within: 20_000 })).toBe(true)
      await mounted.lift()
      mounted.reload()
      await settle(500)
      mounted.reload()
      await settle(500)

      expect(await mounted.frame()).not.toContain(HEADING)
      expect(calls).toEqual({ claims: 1, fetches: 1 })
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('does not reopen when the fetch finishes after the popup was dismissed while loading', async () => {
    const fetchGate = promiseGate()
    const { deps, calls } = countingDeps({ decision: CHANGED, fetchGate: fetchGate.gate })
    const mounted = await mount(deps)

    try {
      expect(await mounted.showing(LOADING)).toBe(true)
      mounted.pressEscape()
      expect(await until({ holds: async () => !(await mounted.frame()).includes(HEADING), within: 20_000 })).toBe(true)

      fetchGate.release()
      await settle(500)

      const frame = await mounted.frame()
      expect(frame).not.toContain(HEADING)
      expect(frame).not.toContain('the notes body for thirty-two')
      expect(calls.fetches).toBe(1)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('shows nothing when the launch was not a version change', async () => {
    for (const decision of [{ kind: 'first-run' }, { kind: 'unchanged' }] as const) {
      const { deps, calls } = countingDeps({ decision })
      const mounted = await mount(deps)

      try {
        expect(await until({ holds: async () => calls.claims === 1, within: 20_000 })).toBe(true)
        await settle(300)

        expect(await mounted.frame()).not.toContain(HEADING)
        expect(calls.fetches).toBe(0)
      } finally {
        await mounted.done()
      }
    }
  }, 60_000)
})
