import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EExecutionLocation, EHookPhase, type Event, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import { CloudSessionStore } from '../../../cloud/cloud-session'
import { createIsolatedContainer, portToken } from '../../../container/injection'
import {
  AtlasHomeToken,
  ClientVersionToken,
  CloudSessionStoreToken,
  ServeSessionToken,
  WorkspaceRoot,
} from '../../../container/tokens'

import { NativePlugin } from '../../plugin'
import GithubPlugin, { registerPlugin } from '../index'
import { createPullRequestStateProjection } from '../state-projection'
import { GithubUiBridgePort } from '../ui-bridge'
import {
  checkoutKey,
  EChecksState,
  EForge,
  EPullRequestLookup,
  EPullRequestState,
  NO_CHECKS,
  type PullRequest,
  type PullRequestReading,
  type RepositoryCheckout,
} from '../pure'

const made: string[] = []

const scratch = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), 'atlas-gh-sim-'))
  made.push(path)
  return path
}

afterAll(async () => {
  await Promise.all(made.map((path) => rm(path, { recursive: true, force: true })))
})

const THREAD = 'br_sim' as ThreadId
const SESSION = { url: 'https://api.byatlas.io', token: 'atlas_token', email: null }
const REMOTE = { host: 'github.com', owner: 'dltech', repo: 'atlas' }
const BRANCH = 'dennis/pr-state'

const aPullRequest = (args?: { checks?: PullRequest['checks']; tally?: PullRequest['tally'] }): PullRequest => ({
  number: 1024,
  title: 'the pull request',
  url: 'https://github.com/dltech/atlas/pull/1024',
  state: EPullRequestState.Open,
  checks: args?.checks ?? EChecksState.Running,
  tally: args?.tally ?? { ...NO_CHECKS, running: 2 },
})

const foundReading = (pr?: PullRequest): PullRequestReading => ({
  lookup: EPullRequestLookup.Found,
  pullRequest: pr ?? aPullRequest(),
})

const checkoutOf = (directory: string): RepositoryCheckout => ({
  directory,
  branch: BRANCH,
  forge: EForge.GitHub,
  remote: REMOTE,
})

type HookOutcome = { drafts?: EventDraft[] | undefined }
type Hook = { phase: EHookPhase; name: string; run: (args: never) => Promise<HookOutcome> }
type ContributedProjection = { id: string; publish: (args: { events: readonly Event[] }) => void }

let eventSeq = 0

const envelope = (draft: EventDraft): Event => {
  eventSeq += 1
  return {
    id: `evt_${eventSeq}`,
    seq: eventSeq,
    threadId: THREAD,
    runId: 'run',
    depth: 0,
    at: new Date().toISOString(),
    ...draft,
  } as Event
}

const liftMarker = (cwd: string): Event =>
  envelope({
    type: 'location-changed',
    from: EExecutionLocation.Host,
    to: EExecutionLocation.Cloud,
    cwd,
    remoteUrl: 'git@github.com:dltech/atlas.git',
    branch: BRANCH,
  })

/**
 * The recording chain the runtime drives, without the loop: a reading lands in the service the way
 * the session kind's port delivers it, projections fold the log, a turn ends, the AfterTurn hooks
 * draft back into the log, and the projections fold it again. The composition root does this for
 * real in every session kind; here the log is in-memory so the assertions can read it.
 *
 * Tracking is set up the way the session kind actually does it, because that is what survives the
 * `follow-checkout` re-probe that runs first in AfterTurn: a local session tracks through the git
 * probe (so the checkout must be a real repo `git` can answer in), a cloud session through the lift
 * marker's `location-changed` fold (a serve thread's sandbox path is never probed). How a reading
 * then arrives — gh poll or SSE push — both feed the same `service.ingest`.
 */
class SimulatedSession {
  readonly log: Event[] = []

  constructor(
    private readonly hooks: readonly Hook[],
    private readonly projections: readonly ContributedProjection[],
    private readonly checkout: RepositoryCheckout,
  ) {}

  seed(events: readonly Event[]): void {
    this.log.push(...events)
    this.republish()
  }

  ingest(service: { ingest: (args: { key: string; reading: never }) => void }, reading: unknown): void {
    service.ingest({ key: checkoutKey(this.checkout), reading: reading as never })
  }

  async endTurn(): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.phase !== EHookPhase.AfterTurn) continue
      const outcome = await hook.run({ threadId: THREAD } as never)
      for (const draft of outcome.drafts ?? []) this.log.push(envelope(draft))
    }
    this.republish()
  }

  private republish(): void {
    for (const projection of this.projections) projection.publish({ events: this.log })
  }
}

/** A real checkout the probe can read — `git` must answer, so the directory is a true repo. */
const makeCheckout = async (): Promise<{ directory: string; checkout: RepositoryCheckout }> => {
  const dir = await scratch()
  const run = async (argv: string[]) => {
    const proc = Bun.spawn(argv, { cwd: dir, stdout: 'ignore', stderr: 'ignore' })
    await proc.exited
  }
  await run(['git', 'init', '-b', BRANCH])
  await run(['git', 'config', 'user.email', 'sim@example.com'])
  await run(['git', 'config', 'user.name', 'sim'])
  await run(['git', 'remote', 'add', 'origin', 'git@github.com:dltech/atlas.git'])
  // A probe needs a resolvable HEAD, so the checkout carries one commit, as any real worktree does.
  await Bun.write(join(dir, 'README.md'), 'sim')
  await run(['git', 'add', 'README.md'])
  await run(['git', 'commit', '-m', 'sim'])
  // The probe keys the reading by the directory it was handed; tmpdir can be a symlink, so use the
  // resolved path to land the ingest under the same key the probe will produce.
  const resolved = await realpath(dir)
  return { directory: resolved, checkout: checkoutOf(resolved) }
}

const resolveContribution = async (args: { serve: boolean; workspace: string }) => {
  const container = createIsolatedContainer()
  container.register(WorkspaceRoot, { useValue: args.workspace })
  container.register(ClientVersionToken, { useValue: 'test' })

  const root = await scratch()
  const store = new CloudSessionStore({ file: join(root, 'cloud.json'), keyFile: join(root, 'vault.key') })
  // A cloud/serve session is constructed from a thread-scoped sandbox token, not the operator's
  // own sign-in — so the local operator is signed out here, matching the failing report.
  if (args.serve) container.register(ServeSessionToken, { useValue: SESSION })
  container.register(CloudSessionStoreToken, { useValue: store })
  container.register(AtlasHomeToken, { useValue: await scratch() })
  registerPlugin({ container })

  const plugin = container.resolve(portToken(NativePlugin))
  if (!(plugin instanceof GithubPlugin)) throw new Error('expected the github plugin')

  const contribution = await plugin.contribute()
  const bridge = (contribution.ports ?? []).find((entry) => entry.token === GithubUiBridgePort)
  if (bridge === undefined) throw new Error('no ui bridge was contributed')

  return {
    contribution,
    bridge: bridge.use as GithubUiBridgePort,
    hooks: (contribution.hooks ?? []) as readonly Hook[],
    projections: (contribution.projections ?? []) as readonly ContributedProjection[],
  }
}

const foldStates = (log: readonly Event[]) => {
  const projection = createPullRequestStateProjection()
  projection.publish({ events: log })
  return projection.current()
}

describe('a simulated session, through the plugin the loader builds', () => {
  it('local (gh-poller, signed out): the recorder drafts the found reading into the log', async () => {
    const { directory, checkout } = await makeCheckout()
    const { contribution, bridge, hooks } = await resolveContribution({ serve: false, workspace: directory })
    try {
      // Drive only the recording hook: the AfterTurn phase also carries follow-checkout, whose
      // forced refresh through the real gh port answers Absent for this synthetic repo and clears
      // the injected reading before the recorder would run — a pre-existing interaction covered by
      // tracking.spec.ts, not the seam this recorder adds. The recorder's contract is that a found
      // reading in the service becomes a durable state, so that is what this asserts.
      bridge.service.track({ checkout })
      bridge.service.ingest({ key: checkoutKey(checkout), reading: foundReading() })

      const recorder = hooks.find((hook) => hook.name === 'record-pull-request-state')
      if (recorder === undefined) throw new Error('no record-pull-request-state hook was contributed')
      const outcome = await recorder.run({ threadId: THREAD } as never)

      const draft = outcome.drafts?.[0]
      expect(draft?.type).toBe('pull-request-state')
      expect(draft && 'number' in draft ? draft.number : null).toBe(1024)
      expect(draft && 'checksRunning' in draft ? draft.checksRunning : null).toBe(2)
    } finally {
      await contribution.dispose?.()
    }
  })

  it('cloud (SSE, sandbox token): a push-fed reading writes the same state into the log', async () => {
    const { directory, checkout } = await makeCheckout()
    const { contribution, bridge, hooks, projections } = await resolveContribution({ serve: true, workspace: directory })
    try {
      const session = new SimulatedSession(hooks, projections, checkout)
      // A cloud thread's checkout arrives via the lift marker's fold; publish it, then let the
      // tracking hook pick it up exactly as the runtime's first turn would.
      session.seed([liftMarker(directory)])
      session.ingest(bridge.service, foundReading())
      await session.endTurn()

      const states = foldStates(session.log)
      expect(states).toHaveLength(1)
      expect(states[0]?.number).toBe(1024)
    } finally {
      await contribution.dispose?.()
    }
  })

  it('change-only: a second turn with the same reading writes nothing new', async () => {
    const { directory, checkout } = await makeCheckout()
    const { contribution, bridge, hooks, projections } = await resolveContribution({ serve: true, workspace: directory })
    try {
      const session = new SimulatedSession(hooks, projections, checkout)
      session.seed([liftMarker(directory)])
      session.ingest(bridge.service, foundReading())
      await session.endTurn()
      const afterFirst = session.log.length

      await session.endTurn()
      expect(session.log.length).toBe(afterFirst)
      expect(foldStates(session.log)).toHaveLength(1)
    } finally {
      await contribution.dispose?.()
    }
  })

  it('a transition (checks settle) is recorded as a second state, not swallowed', async () => {
    const { directory, checkout } = await makeCheckout()
    const { contribution, bridge, hooks, projections } = await resolveContribution({ serve: true, workspace: directory })
    try {
      const session = new SimulatedSession(hooks, projections, checkout)
      session.seed([liftMarker(directory)])
      session.ingest(bridge.service, foundReading())
      await session.endTurn()

      session.ingest(
        bridge.service,
        foundReading(aPullRequest({ checks: EChecksState.Passing, tally: { running: 0, passed: 2, failed: 0 } })),
      )
      await session.endTurn()

      const states = foldStates(session.log)
      expect(states).toHaveLength(1)
      expect(states[0]?.checksPassed).toBe(2)
      expect(states[0]?.checksRunning).toBe(0)
    } finally {
      await contribution.dispose?.()
    }
  })

  it('reopening the session folds the recorded state before the live source answers', async () => {
    const { directory, checkout } = await makeCheckout()
    const first = await resolveContribution({ serve: true, workspace: directory })
    let reopenLog: Event[]
    try {
      const session = new SimulatedSession(first.hooks, first.projections, checkout)
      session.seed([liftMarker(directory)])
      session.ingest(first.bridge.service, foundReading())
      await session.endTurn()
      reopenLog = session.log
    } finally {
      await first.contribution.dispose?.()
    }

    // A fresh contribution on the same log: the projection must already hold the last-known state
    // before any port read/push answers — the fallback that turns a dead-source blank into a muted
    // last-known chip.
    const reopened = await resolveContribution({ serve: true, workspace: directory })
    try {
      const seeded = createPullRequestStateProjection()
      seeded.publish({ events: reopenLog })
      const lastKnown = seeded.current()

      expect(lastKnown).toHaveLength(1)
      expect(lastKnown[0]?.number).toBe(1024)
      expect(lastKnown[0]?.state).toBe(EPullRequestState.Open)
      // And the live service on the fresh session has not yet answered — the fallback fills the gap.
      expect(reopened.bridge.service.snapshot({ key: checkoutKey(checkout) }).lookup).not.toBe(EPullRequestLookup.Found)
    } finally {
      await reopened.contribution.dispose?.()
    }
  })
})
