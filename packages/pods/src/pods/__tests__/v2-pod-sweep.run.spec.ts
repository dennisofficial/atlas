import { describe, expect, it } from 'bun:test'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import type { SandboxCredentials } from '../../sandbox/sandbox-provider'
import { sweepV2Pods } from '../v2-pod-sweep'
import {
  actDirectly,
  AGENT37_CREDENTIALS,
  FakeSandboxProvider,
  NOW,
  hoursAgo,
  listing,
  noPods,
  scope,
} from '../v2-pod-sweep.fixture'

describe('sweepV2Pods', () => {
  it('stops and deletes through the port, naming pods by their session id', async () => {
    const sandbox = new FakeSandboxProvider({
      listings: [
        listing({ sandboxSessionId: 'ses-running', running: true }),
        listing({ sandboxSessionId: 'ses-stopped' }),
        listing({ sandboxSessionId: 'ses-live', running: true }),
      ],
    })

    const summary = await sweepV2Pods({
      scopes: [scope(sandbox)],
      pods: { live: new Set(['ses-live']), retirable: new Map([['ses-running', hoursAgo(25)]]) },
      fence: actDirectly,
      now: NOW,
      dryRun: false,
      log: () => undefined,
    })

    expect(summary).toMatchObject({
      scopes: 1,
      scanned: 3,
      stopped: 1,
      deleted: 1,
      kept: 1,
      failed: 0,
      failedScopes: [],
    })
    expect(sandbox.stopped).toEqual(['ses-running'])
    expect(sandbox.deleted).toEqual(['ses-stopped'])
    expect(sandbox.credentialsSeen).toEqual([AGENT37_CREDENTIALS])
  })

  it('retires every swept pod and ends the terminals it hosted', async () => {
    const sandbox = new FakeSandboxProvider({
      listings: [
        listing({ sandboxSessionId: 'ses-running', running: true }),
        listing({ sandboxSessionId: 'ses-stopped' }),
      ],
    })
    const retired: string[] = []
    const terminalPods: string[][] = []

    await sweepV2Pods({
      scopes: [scope(sandbox)],
      pods: { live: new Set(), retirable: new Map([['ses-running', hoursAgo(25)]]) },
      fence: actDirectly,
      onRetired: async ({ podSessionId }) => {
        retired.push(podSessionId)
      },
      endTerminals: async ({ podSessionIds }) => {
        terminalPods.push([...podSessionIds])
        return 0
      },
      now: NOW,
      dryRun: false,
      log: () => undefined,
    })

    expect(retired.sort()).toEqual(['ses-running', 'ses-stopped'])
    expect(terminalPods).toEqual([['ses-running', 'ses-stopped']])
  })

  it('lets one scope fail without stopping the others, and names it', async () => {
    const broken = new FakeSandboxProvider({ failList: 'token revoked' })
    const healthy = new FakeSandboxProvider({
      listings: [listing({ sandboxSessionId: 'ses-gone' })],
    })
    const lines: string[] = []

    const summary = await sweepV2Pods({
      scopes: [
        { label: 'usr-1/prj-byok', credentials: AGENT37_CREDENTIALS, sandbox: broken },
        scope(healthy),
      ],
      pods: noPods,
      fence: actDirectly,
      now: NOW,
      dryRun: false,
      log: (line) => lines.push(line),
    })

    expect(summary).toMatchObject({
      scopes: 2,
      scanned: 1,
      deleted: 1,
      failed: 1,
      failedScopes: ['usr-1/prj-byok'],
    })
    expect(healthy.deleted).toEqual(['ses-gone'])
    expect(lines.some((line) => line.includes('usr-1/prj-byok: could not list its pods'))).toBe(
      true,
    )
  })

  it('keeps the other pods when one stop fails', async () => {
    const sandbox = new FakeSandboxProvider({
      listings: [
        listing({ sandboxSessionId: 'ses-refusing', running: true }),
        listing({ sandboxSessionId: 'ses-sleeping', running: true }),
      ],
      failStop: 'provider said no',
    })

    const summary = await sweepV2Pods({
      scopes: [scope(sandbox)],
      pods: {
        live: new Set(),
        retirable: new Map([
          ['ses-refusing', hoursAgo(25)],
          ['ses-sleeping', hoursAgo(25)],
        ]),
      },
      fence: actDirectly,
      now: NOW,
      dryRun: false,
      log: () => undefined,
    })

    expect(summary).toMatchObject({ stopped: 0, failed: 2 })
  })

  it('skips the pod that was unarchived inside its fence, and deletes the rest', async () => {
    const sandbox = new FakeSandboxProvider({
      listings: [
        listing({ sandboxSessionId: 'ses-revived' }),
        listing({ sandboxSessionId: 'ses-gone' }),
      ],
    })
    const retired: string[] = []

    const summary = await sweepV2Pods({
      scopes: [scope(sandbox)],
      pods: noPods,
      fence: async ({ podSessionId, act }) => {
        if (podSessionId === 'ses-revived') return 'kept'
        await act()
        return 'acted'
      },
      onRetired: async ({ podSessionId }) => {
        retired.push(podSessionId)
      },
      now: NOW,
      dryRun: false,
      log: () => undefined,
    })

    expect(sandbox.deleted).toEqual(['ses-gone'])
    expect(retired).toEqual(['ses-gone'])
    expect(summary).toMatchObject({ deleted: 1, kept: 1, failed: 0 })
  })

  it('keeps a running pod when it went live before the stop', async () => {
    const sandbox = new FakeSandboxProvider({
      listings: [listing({ sandboxSessionId: 'ses-revived', running: true })],
    })

    await sweepV2Pods({
      scopes: [scope(sandbox)],
      pods: { live: new Set(), retirable: new Map([['ses-revived', hoursAgo(25)]]) },
      fence: async () => 'kept',
      now: NOW,
      dryRun: false,
      log: () => undefined,
    })

    expect(sandbox.stopped).toEqual([])
  })

  it('counts a pod whose fence threw as a failure, and carries on', async () => {
    const sandbox = new FakeSandboxProvider({
      listings: [listing({ sandboxSessionId: 'ses-a' }), listing({ sandboxSessionId: 'ses-b' })],
    })
    const lines: string[] = []

    const summary = await sweepV2Pods({
      scopes: [scope(sandbox)],
      pods: noPods,
      fence: async ({ podSessionId, act }) => {
        if (podSessionId === 'ses-a') throw new Error('lock timeout')
        await act()
        return 'acted'
      },
      now: NOW,
      dryRun: false,
      log: (line) => lines.push(line),
    })

    expect(summary).toMatchObject({ deleted: 1, failed: 1 })
    expect(sandbox.deleted).toEqual(['ses-b'])
    expect(lines.some((line) => line.includes('ses-a: Error: lock timeout'))).toBe(true)
  })

  it('touches nothing on a dry run but still reports the plan', async () => {
    const sandbox = new FakeSandboxProvider({
      listings: [listing({ sandboxSessionId: 'ses-gone' })],
    })
    const retired: string[] = []
    const fences: string[] = []

    const summary = await sweepV2Pods({
      scopes: [scope(sandbox)],
      pods: noPods,
      fence: async ({ podSessionId, act }) => {
        fences.push(podSessionId)
        await act()
        return 'acted'
      },
      onRetired: async ({ podSessionId }) => {
        retired.push(podSessionId)
      },
      now: NOW,
      dryRun: true,
      log: () => undefined,
    })

    expect(summary).toMatchObject({ scanned: 1, deleted: 0, stopped: 0, dryRun: true })
    expect(sandbox.deleted).toEqual([])
    expect(retired).toEqual([])
    expect(fences).toEqual([])
  })
})

describe('sweepV2Pods credentials', () => {
  it('hands each scope its own credentials', async () => {
    const vercel: SandboxCredentials = {
      provider: ESandboxProvider.Vercel,
      token: 'user-token',
      teamId: 'team-1',
      projectId: 'prj-1',
    }
    const sandbox = new FakeSandboxProvider({})

    await sweepV2Pods({
      scopes: [{ label: 'usr-1/prj-1', credentials: vercel, sandbox }],
      pods: noPods,
      fence: actDirectly,
      now: NOW,
      dryRun: false,
      log: () => undefined,
    })

    expect(sandbox.credentialsSeen).toEqual([vercel])
  })
})
