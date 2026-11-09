import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'
import { describe, expect, it } from 'bun:test'

import {
  ESubscriptionActor,
  toThreadId,
  type EventDraft,
  type PluginEventBody,
  type RecordBody,
  type V2Event,
} from '@dltech/atlas-core'
import { ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'
import {
  EMPTY_CREW,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'

import {
  GITHUB_EVENT_RUN_ERROR,
  NO_RUN_ERROR,
  NO_RUN_REPOSITORY_ERROR,
  UNRECOGNIZED_RUN_ERROR,
} from '../../core'
import { githubPod } from '..'
import { resolveRunTarget } from '../resolve-target'

type Drafts = readonly (EventDraft | RecordBody | PluginEventBody)[]

const exec =
  (text: string, exitCode = 0) =>
  (onOutput?: (b: Uint8Array) => void): CallResult => {
    onOutput?.(new TextEncoder().encode(text))
    return {
      status: ECallStatus.Ok,
      op: 'exec',
      value: { exitCode, signal: null, outcome: 'exited', outputBytes: text.length },
    } as CallResult
  }

const rig = (answers: Record<string, ReturnType<typeof exec>>) => {
  const log: V2Event[] = []
  const calls: string[] = []
  const append = async (drafts: Drafts): Promise<void> => {
    for (const body of drafts) {
      log.push({
        ...body,
        seq: log.length + 1,
        threadId: toThreadId('t1'),
        at: '2026-11-08T10:00:00.000Z',
      } as V2Event)
    }
  }
  const ctx: PluginPodContext = {
    control: podControlStub,
    crew: EMPTY_CREW,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    sessionId: 's1',
    append,
    events: () => log,
    call: async (op: CallOp, options) => {
      const argv = op.op === 'exec' ? op.argv.join(' ') : ''
      calls.push(argv)
      const answer = answers[argv]
      if (answer === undefined) return exec('', 1)(options?.onOutput)
      return answer(options?.onOutput)
    },
    onDaemonEvent: () => () => undefined,
    log: () => undefined,
  }
  return { ctx, log, calls }
}

const invoke = async (args: { ctx: PluginPodContext; name: string; input: unknown }) => {
  const tool = githubPod.tools?.(args.ctx).find((candidate) => candidate.name === args.name)
  if (tool === undefined) throw new Error(`no tool ${args.name}`)
  return tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/work',
    threadId: toThreadId('t1'),
  })
}

const NAME = 'gh repo view --json nameWithOwner -q .nameWithOwner'
const HEAD = 'gh pr view --json headRefName -q .headRefName'
const DEFAULT_BRANCH = 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name'
const LATEST = 'gh run list --limit 1 --json databaseId,name'

describe('resolveRunTarget', () => {
  it('takes a run in another repository straight through without a gh call', async () => {
    const { ctx, calls } = rig({})
    expect(await resolveRunTarget({ ctx, input: 'Dltech/Atlas#9' })).toEqual({
      target: { kind: 'run', repo: 'github.com/dltech/atlas', runId: 9 },
      label: 'dltech/atlas#9',
    })
    expect(
      await resolveRunTarget({ ctx, input: 'https://github.com/o/r/actions/runs/12/job/3' }),
    ).toMatchObject({ target: { kind: 'run', repo: 'github.com/o/r', runId: 12 } })
    expect(calls).toHaveLength(0)
  })

  it('takes a bare run id from the checkout repository', async () => {
    const { ctx } = rig({ [NAME]: exec('o/r') })
    expect(await resolveRunTarget({ ctx, input: '#42' })).toEqual({
      target: { kind: 'run', repo: 'github.com/o/r', runId: 42 },
      label: 'o/r#42',
    })
  })

  it('resolves a blank target to the newest run of the checkout', async () => {
    const { ctx } = rig({
      [NAME]: exec('Dltech/Atlas'),
      [LATEST]: exec('[{"databaseId":77,"name":"deploy"}]'),
    })
    expect(await resolveRunTarget({ ctx, input: '' })).toMatchObject({
      target: { kind: 'run', repo: 'github.com/dltech/atlas', runId: 77 },
    })
  })

  it('refuses a blank target with NO_RUN_ERROR when the checkout has no run', async () => {
    const { ctx } = rig({ [NAME]: exec('o/r'), [LATEST]: exec('[]') })
    expect(await resolveRunTarget({ ctx, input: '' })).toEqual({ error: NO_RUN_ERROR })
  })

  it('refuses a blank target when the repository cannot be read', async () => {
    const { ctx } = rig({})
    expect(await resolveRunTarget({ ctx, input: '' })).toEqual({ error: NO_RUN_REPOSITORY_ERROR })
  })

  it('resolves a selector with an explicit branch against the checkout repository', async () => {
    const { ctx, calls } = rig({ [NAME]: exec('o/r') })
    expect(await resolveRunTarget({ ctx, input: 'Deploy@main' })).toEqual({
      target: { kind: 'selector', repo: 'github.com/o/r', workflow: 'deploy.yml', branch: 'main' },
      label: 'o/r deploy.yml@main',
    })
    expect(calls).toEqual([NAME])
  })

  it('takes a selector branch from the checkout pull request, then the default branch', async () => {
    const fromHead = rig({ [NAME]: exec('o/r'), [HEAD]: exec('release/2.0') })
    expect(await resolveRunTarget({ ctx: fromHead.ctx, input: 'deploy.yml' })).toMatchObject({
      target: { kind: 'selector', workflow: 'deploy.yml', branch: 'release/2.0' },
    })

    const fromDefault = rig({ [NAME]: exec('o/r'), [DEFAULT_BRANCH]: exec('main') })
    expect(await resolveRunTarget({ ctx: fromDefault.ctx, input: 'deploy.yml' })).toMatchObject({
      target: { kind: 'selector', workflow: 'deploy.yml', branch: 'main' },
    })
  })

  it('refuses a selector the checkout cannot place in a repository', async () => {
    const { ctx } = rig({})
    expect(await resolveRunTarget({ ctx, input: 'deploy.yml@main' })).toEqual({
      error: GITHUB_EVENT_RUN_ERROR,
    })
  })

  it('refuses a reference that names no run', async () => {
    const { ctx } = rig({})
    expect(await resolveRunTarget({ ctx, input: 'not a run' })).toEqual({
      error: UNRECOGNIZED_RUN_ERROR,
    })
  })
})

describe('github pod workflow-run subscriptions', () => {
  it('subscribes to a run and appends its target as the API parses it', async () => {
    const { ctx, log } = rig({})
    const outcome = await invoke({
      ctx,
      name: 'subscribe',
      input: { provider: 'github.workflow-run', target: 'o/r#5' },
    })
    expect(outcome.ok).toBe(true)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      type: 'subscription-created',
      provider: 'github.workflow-run',
      label: 'o/r#5',
      target: { kind: 'run', repo: 'github.com/o/r', runId: 5 },
      createdBy: ESubscriptionActor.Agent,
    })
  })

  it('subscribes to a selector as a selector target', async () => {
    const { ctx, log } = rig({ [NAME]: exec('o/r') })
    await invoke({
      ctx,
      name: 'subscribe',
      input: { provider: 'github.workflow-run', target: 'deploy.yml@main' },
    })
    expect(log[0]).toMatchObject({
      target: { kind: 'selector', repo: 'github.com/o/r', workflow: 'deploy.yml', branch: 'main' },
      label: 'o/r deploy.yml@main',
    })
  })

  it('returns the existing subscription for the same run', async () => {
    const { ctx, log } = rig({})
    await invoke({
      ctx,
      name: 'subscribe',
      input: { provider: 'github.workflow-run', target: 'o/r#5' },
    })
    const again = await invoke({
      ctx,
      name: 'subscribe',
      input: { provider: 'github.workflow-run', target: 'https://github.com/o/r/actions/runs/5' },
    })
    expect(again.ok && again.modelText).toContain('Already subscribed')
    expect(log).toHaveLength(1)
  })

  it('keeps a pull request and a run that share a number apart', async () => {
    const { ctx, log } = rig({})
    await invoke({
      ctx,
      name: 'subscribe',
      input: { provider: 'github.pull-request', target: 'o/r#5' },
    })
    await invoke({
      ctx,
      name: 'subscribe',
      input: { provider: 'github.workflow-run', target: 'o/r#5' },
    })
    expect(log.map((event) => (event as { provider?: string }).provider)).toEqual([
      'github.pull-request',
      'github.workflow-run',
    ])
  })

  it('refuses an unknown provider naming both', async () => {
    const { ctx } = rig({})
    const outcome = await invoke({ ctx, name: 'subscribe', input: { provider: 'slack' } })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.reason).toContain('github.pull-request')
    expect(outcome.ok ? '' : outcome.reason).toContain('github.workflow-run')
  })

  it('lists both providers with a target hint each', async () => {
    const { ctx } = rig({})
    await invoke({
      ctx,
      name: 'subscribe',
      input: { provider: 'github.workflow-run', target: 'o/r#5' },
    })
    const listed = await invoke({ ctx, name: 'list_subscriptions', input: {} })
    const text = listed.ok ? listed.modelText : ''
    expect(text).toContain('github.pull-request')
    expect(text).toContain('github.workflow-run')
    expect(text).toContain('<workflow>@<branch>')
    expect(text).toContain('o/r#5')
  })
})
