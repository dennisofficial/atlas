import { describe, expect, it } from 'bun:test'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import {
  SandboxProvider,
  type DaemonEndpoint,
  type PodResizeOutcome,
  type SandboxCredentials,
  type SandboxListing,
  type SandboxTarget,
} from '../../../agent'
import { planV2Pods, sweepV2Pods, uniqueV2Scopes } from './v2-pod-sweep'

const NOW = new Date('2026-11-10T06:00:00Z')
const hoursAgo = (hours: number): number => NOW.getTime() - hours * 60 * 60 * 1_000

const AGENT37_CREDENTIALS: SandboxCredentials = {
  provider: ESandboxProvider.Agent37,
  apiKey: 'key',
}

const listing = (args: {
  sandboxSessionId: string
  running?: boolean
  createdAt?: number
}): SandboxListing => ({
  sandboxSessionId: args.sandboxSessionId,
  running: args.running ?? false,
  createdAt: args.createdAt ?? hoursAgo(25),
})

class FakeSandboxProvider extends SandboxProvider {
  readonly stopped: string[] = []
  readonly deleted: string[] = []
  readonly credentialsSeen: SandboxCredentials[] = []

  constructor(
    private readonly args: {
      listings?: readonly SandboxListing[]
      failList?: string
      failStop?: string
      failDelete?: string
    },
  ) {
    super()
  }

  async list(args: { credentials: SandboxCredentials }): Promise<readonly SandboxListing[]> {
    this.credentialsSeen.push(args.credentials)
    if (this.args.failList !== undefined) throw new Error(this.args.failList)
    return this.args.listings ?? []
  }

  async stop(args: { target: SandboxTarget }): Promise<void> {
    if (this.args.failStop !== undefined) throw new Error(this.args.failStop)
    this.stopped.push(args.target.sandboxSessionId)
  }

  async delete(args: { target: SandboxTarget }): Promise<void> {
    if (this.args.failDelete !== undefined) throw new Error(this.args.failDelete)
    this.deleted.push(args.target.sandboxSessionId)
  }

  async wake(): Promise<DaemonEndpoint> {
    throw new Error('the sweep never wakes a pod')
  }

  async keepAlive(): Promise<void> {
    throw new Error('the sweep never touches a deadline')
  }

  async resize(): Promise<PodResizeOutcome> {
    throw new Error('the sweep never resizes a pod')
  }
}

const scope = (sandbox: SandboxProvider) => ({
  label: 'platform/agent37',
  credentials: AGENT37_CREDENTIALS,
  sandbox,
})

const noPods = { live: new Set<string>(), retirable: new Set<string>() }

describe('planV2Pods', () => {
  it('stops a running pod whose sessions are all archived, and deletes a stopped one', () => {
    const plan = planV2Pods({
      pods: [
        listing({ sandboxSessionId: 'pod-running', running: true }),
        listing({ sandboxSessionId: 'pod-stopped' }),
        listing({ sandboxSessionId: 'pod-live', running: true, createdAt: hoursAgo(1) }),
        listing({ sandboxSessionId: 'pod-fresh', createdAt: hoursAgo(1) }),
      ],
      live: new Set(['pod-live']),
      retirable: new Set(['pod-running']),
      now: NOW,
    })

    expect(plan.stop).toEqual(['pod-running'])
    expect(plan.delete).toEqual(['pod-stopped'])
  })

  it('leaves a running pod alone unless every session on it is archived', () => {
    const plan = planV2Pods({
      pods: [listing({ sandboxSessionId: 'pod-busy', running: true })],
      live: new Set(),
      retirable: new Set(),
      now: NOW,
    })

    expect(plan).toEqual({ stop: [], delete: [] })
  })

  it('waits out the grace before touching a pod created inside it', () => {
    const fresh = listing({ sandboxSessionId: 'pod-fresh', createdAt: NOW.getTime() - 60_000 })

    expect(
      planV2Pods({ pods: [fresh], live: new Set(), retirable: new Set(), now: NOW }).delete,
    ).toEqual([])
    expect(
      planV2Pods({
        pods: [fresh],
        live: new Set(),
        retirable: new Set(),
        now: new Date(NOW.getTime() + 24 * 60 * 60 * 1_000),
      }).delete,
    ).toEqual(['pod-fresh'])
  })
})

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
      pods: { live: new Set(['ses-live']), retirable: new Set(['ses-running']) },
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
      pods: { live: new Set(), retirable: new Set(['ses-running']) },
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

  it('lets one scope fail without stopping the others', async () => {
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
      now: NOW,
      dryRun: false,
      log: (line) => lines.push(line),
    })

    expect(summary).toMatchObject({ scopes: 2, scanned: 1, deleted: 1, failed: 1 })
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
      pods: { live: new Set(), retirable: new Set(['ses-refusing', 'ses-sleeping']) },
      now: NOW,
      dryRun: false,
      log: () => undefined,
    })

    expect(summary).toMatchObject({ stopped: 0, failed: 2 })
  })

  it('skips the pod that was unarchived between the listing and the delete', async () => {
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
      stillRetirable: async ({ podSessionId }) => podSessionId !== 'ses-revived',
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
      pods: { live: new Set(), retirable: new Set(['ses-revived']) },
      stillRetirable: async () => false,
      now: NOW,
      dryRun: false,
      log: () => undefined,
    })

    expect(sandbox.stopped).toEqual([])
  })

  it('touches nothing on a dry run but still reports the plan', async () => {
    const sandbox = new FakeSandboxProvider({
      listings: [listing({ sandboxSessionId: 'ses-gone' })],
    })
    const retired: string[] = []

    const summary = await sweepV2Pods({
      scopes: [scope(sandbox)],
      pods: noPods,
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
  })
})

describe('uniqueV2Scopes', () => {
  const vercelCredentials = (args: {
    teamId: string
    projectId: string
    token: string
  }): SandboxCredentials => ({
    provider: ESandboxProvider.Vercel,
    token: args.token,
    teamId: args.teamId,
    projectId: args.projectId,
  })
  const vercelScope = (label: string, token: string, projectId = 'prj-1') => ({
    label,
    credentials: vercelCredentials({ teamId: 'team-1', projectId, token }),
    sandbox: new FakeSandboxProvider({}),
  })

  it('keeps one scope per Vercel team and project, platform first', () => {
    const scopes = uniqueV2Scopes([
      vercelScope('platform/vercel', 'platform-token'),
      vercelScope('usr-1/prj-1', 'user-token'),
      vercelScope('usr-1/prj-2', 'user-token', 'prj-2'),
    ])

    expect(scopes.map((scope) => scope.label)).toEqual(['platform/vercel', 'usr-1/prj-2'])
  })

  it('keeps one Agent37 scope, since there is one platform account', () => {
    const agent37 = (label: string) => ({
      label,
      credentials: AGENT37_CREDENTIALS,
      sandbox: new FakeSandboxProvider({}),
    })

    expect(uniqueV2Scopes([agent37('platform/agent37'), agent37('duplicate')])).toHaveLength(1)
  })

  it('keeps the providers apart even for the same label', () => {
    const scopes = uniqueV2Scopes([
      vercelScope('platform', 'platform-token'),
      { label: 'platform', credentials: AGENT37_CREDENTIALS, sandbox: new FakeSandboxProvider({}) },
    ])

    expect(scopes).toHaveLength(2)
  })
})
