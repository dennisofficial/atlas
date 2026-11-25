import { describe, expect, it } from 'bun:test'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import type { SandboxCredentials } from '../../sandbox/sandbox-provider'
import { planPods, uniqueScopes } from '../pod-sweep'
import {
  AGENT37_CREDENTIALS,
  FakeSandboxProvider,
  NOW,
  hoursAgo,
  listing,
} from '../pod-sweep.fixture'

describe('planPods', () => {
  it('stops a running pod whose sessions are all archived, and deletes a stopped one', () => {
    const plan = planPods({
      pods: [
        listing({ sandboxSessionId: 'pod-running', running: true }),
        listing({ sandboxSessionId: 'pod-stopped' }),
        listing({ sandboxSessionId: 'pod-live', running: true, createdAt: hoursAgo(1) }),
        listing({ sandboxSessionId: 'pod-fresh', createdAt: hoursAgo(1) }),
      ],
      live: new Set(['pod-live']),
      retirable: new Map([['pod-running', hoursAgo(25)]]),
      now: NOW,
    })

    expect(plan.stop).toEqual(['pod-running'])
    expect(plan.delete).toEqual(['pod-stopped'])
  })

  it('stops a running pod no session row resolves, once its own creation is past the grace', () => {
    const plan = planPods({
      pods: [
        listing({ sandboxSessionId: 'pod-orphan', running: true }),
        listing({ sandboxSessionId: 'pod-orphan-fresh', running: true, createdAt: hoursAgo(1) }),
      ],
      live: new Set(),
      retirable: new Map(),
      now: NOW,
    })

    expect(plan).toEqual({ stop: ['pod-orphan'], delete: [] })
  })

  it('counts the grace from the archive, not from the pod in front of it', () => {
    const plan = planPods({
      pods: [listing({ sandboxSessionId: 'pod-rebuilt', createdAt: hoursAgo(1) })],
      live: new Set(),
      retirable: new Map([['pod-rebuilt', hoursAgo(30)]]),
      now: NOW,
    })

    expect(plan.delete).toEqual(['pod-rebuilt'])
  })

  it('leaves a pod whose archive is still inside the grace', () => {
    const plan = planPods({
      pods: [listing({ sandboxSessionId: 'pod-fresh-archive', running: true })],
      live: new Set(),
      retirable: new Map([['pod-fresh-archive', hoursAgo(1)]]),
      now: NOW,
    })

    expect(plan).toEqual({ stop: [], delete: [] })
  })

  it('waits out the grace before touching a pod created inside it', () => {
    const fresh = listing({ sandboxSessionId: 'pod-fresh', createdAt: NOW.getTime() - 60_000 })

    expect(
      planPods({ pods: [fresh], live: new Set(), retirable: new Map(), now: NOW }).delete,
    ).toEqual([])
    expect(
      planPods({
        pods: [fresh],
        live: new Set(),
        retirable: new Map(),
        now: new Date(NOW.getTime() + 24 * 60 * 60 * 1_000),
      }).delete,
    ).toEqual(['pod-fresh'])
  })
})

describe('uniqueScopes', () => {
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
    const scopes = uniqueScopes([
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

    expect(uniqueScopes([agent37('platform/agent37'), agent37('duplicate')])).toHaveLength(1)
  })

  it('keeps the providers apart even for the same label', () => {
    const scopes = uniqueScopes([
      vercelScope('platform', 'platform-token'),
      { label: 'platform', credentials: AGENT37_CREDENTIALS, sandbox: new FakeSandboxProvider({}) },
    ])

    expect(scopes).toHaveLength(2)
  })
})
