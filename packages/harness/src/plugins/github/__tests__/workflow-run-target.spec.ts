import { describe, expect, it } from 'bun:test'

import { EForge } from '../pure'
import { aCheckout } from '../testing'
import {
  BAD_RUN_ID_ERROR,
  EWorkflowRunTargetKind,
  labelOf,
  NO_CHECKOUT_ERROR,
  NO_RUN_ERROR,
  NOT_GITHUB_ERROR,
  resolveWorkflowRunTarget,
  targetKey,
  targetOf,
  UNRECOGNIZED_ERROR,
  workflowRunRepoOf,
  type WorkflowRunTarget,
} from '../workflow-run-target'

const CHECKOUT = aCheckout()
const REPO = 'github.com/dennisofficial/atlas'
const FOUND = { runId: 33522901117, workflow: 'Build' }

const PINNED = {
  target: { kind: EWorkflowRunTargetKind.Run, repo: REPO, runId: 33522901117 },
  label: 'dennisofficial/atlas#33522901117 \u00b7 Build',
}

const resolve = (args: {
  input: string
  checkout?: ReturnType<typeof aCheckout> | null
  foundRun?: { runId: number; workflow: string } | null
}) =>
  resolveWorkflowRunTarget({
    input: args.input,
    checkout: args.checkout === undefined ? CHECKOUT : args.checkout,
    foundRun: args.foundRun === undefined ? FOUND : args.foundRun,
  })

const SELECTOR = (
  args: { workflow?: string; branch?: string } = {},
): {
  target: WorkflowRunTarget
  label: string
} => {
  const workflow = args.workflow ?? 'deploy.yml'
  const branch = args.branch ?? 'main'

  return {
    target: { kind: EWorkflowRunTargetKind.Selector, repo: REPO, workflow, branch },
    label: `dennisofficial/atlas ${workflow}@${branch}`,
  }
}

describe('the workflow run target grammar', () => {
  it('takes a blank input from the newest run for the checkout', () => {
    expect(resolve({ input: '' })).toEqual(PINNED)
    expect(resolve({ input: '   ' })).toEqual(PINNED)
  })

  it('refuses a blank input with no checkout', () => {
    expect(resolve({ input: '', checkout: null })).toEqual({ error: NO_CHECKOUT_ERROR })
  })

  it('refuses a blank input when no run exists for the checkout HEAD yet', () => {
    expect(resolve({ input: '', foundRun: null })).toEqual({ error: NO_RUN_ERROR })
  })

  it('takes #12345 and 12345 from the checkout repository', () => {
    const pinned = {
      target: { kind: EWorkflowRunTargetKind.Run, repo: REPO, runId: 12345 },
      label: 'dennisofficial/atlas#12345',
    }

    expect(resolve({ input: '#12345', foundRun: null })).toEqual(pinned)
    expect(resolve({ input: '12345', foundRun: null })).toEqual(pinned)
  })

  it('refuses a bare run id with no checkout', () => {
    expect(resolve({ input: '#12345', checkout: null })).toEqual({ error: NO_CHECKOUT_ERROR })
    expect(resolve({ input: '12345', checkout: null })).toEqual({ error: NO_CHECKOUT_ERROR })
  })

  it('takes owner/repo#12345 anywhere', () => {
    expect(resolve({ input: 'dennisofficial/atlas#12345', checkout: null })).toEqual({
      target: { kind: EWorkflowRunTargetKind.Run, repo: REPO, runId: 12345 },
      label: 'dennisofficial/atlas#12345',
    })
    expect(resolve({ input: 'a-b/c.d_e#7' })).toEqual({
      target: { kind: EWorkflowRunTargetKind.Run, repo: 'github.com/a-b/c.d_e', runId: 7 },
      label: 'a-b/c.d_e#7',
    })
  })

  it('takes a run URL, with or without a trailing path, query or fragment', () => {
    for (const input of [
      'https://github.com/dennisofficial/atlas/actions/runs/12345',
      'https://github.com/dennisofficial/atlas/actions/runs/12345/',
      'https://github.com/dennisofficial/atlas/actions/runs/12345/attempts/2',
      'https://github.com/dennisofficial/atlas/actions/runs/12345/job/9',
      'https://github.com/dennisofficial/atlas/actions/runs/12345#step:3:1',
      'https://github.com/dennisofficial/atlas/actions/runs/12345?check_suite_focus=true',
      'http://github.com/dennisofficial/atlas/actions/runs/12345',
    ]) {
      expect(resolve({ input, checkout: null })).toEqual({
        target: { kind: EWorkflowRunTargetKind.Run, repo: REPO, runId: 12345 },
        label: 'dennisofficial/atlas#12345',
      })
    }
  })

  it('takes a workflow and branch selector whatever the casing of the workflow', () => {
    expect(resolve({ input: 'deploy.yml@main' })).toEqual(SELECTOR())
    expect(resolve({ input: 'Deploy@main' })).toEqual(SELECTOR())
    expect(resolve({ input: 'deploy.yaml@release/2.0' })).toEqual(
      SELECTOR({ workflow: 'deploy.yaml', branch: 'release/2.0' }),
    )
    expect(resolve({ input: '.github/workflows/deploy.yml@main' })).toEqual(
      SELECTOR({ workflow: '.github/workflows/deploy.yml' }),
    )
  })

  it('takes a workflow file alone on the checkout branch', () => {
    const feature = aCheckout({ branch: 'feature-x' })

    expect(resolve({ input: 'deploy.yml', checkout: feature })).toEqual(
      SELECTOR({ branch: 'feature-x' }),
    )
  })

  it('refuses a selector with no checkout to name the repository', () => {
    expect(resolve({ input: 'deploy.yml@main', checkout: null })).toEqual({
      error: NO_CHECKOUT_ERROR,
    })
    expect(resolve({ input: 'deploy.yml', checkout: null })).toEqual({ error: NO_CHECKOUT_ERROR })
  })

  it('refuses a GitHub Enterprise checkout, which a github.com target cannot name', () => {
    const enterprise = aCheckout({ host: 'acme.ghe.com' })

    expect(resolve({ input: '', checkout: enterprise })).toEqual({ error: NOT_GITHUB_ERROR })
    expect(resolve({ input: '#12345', checkout: enterprise })).toEqual({ error: NOT_GITHUB_ERROR })
    expect(resolve({ input: 'deploy.yml', checkout: enterprise })).toEqual({
      error: NOT_GITHUB_ERROR,
    })
    expect(resolve({ input: '#12345', checkout: aCheckout({ forge: EForge.Other }) })).toEqual({
      error: NOT_GITHUB_ERROR,
    })
  })

  it('lowercases the repository taken from a checkout', () => {
    const mixed = aCheckout({ owner: 'DLTech', repo: 'Atlas' })

    expect(resolve({ input: '#42', checkout: mixed })).toEqual({
      target: { kind: EWorkflowRunTargetKind.Run, repo: 'github.com/dltech/atlas', runId: 42 },
      label: 'dltech/atlas#42',
    })
  })

  it('refuses a zero run id in every form', () => {
    for (const input of ['#0', '0', 'a/b#0', 'https://github.com/a/b/actions/runs/0']) {
      expect(resolve({ input })).toEqual({ error: BAD_RUN_ID_ERROR })
    }
  })

  it('refuses anything else, including other hosts and pull request URLs', () => {
    for (const input of [
      'soon',
      'owner/repo',
      'deploy@main@main',
      'deploy.yml@',
      '#12a',
      'https://gitlab.com/a/b/actions/runs/3',
      'https://github.com/a/b/pull/3',
      'https://github.com/a/b',
    ]) {
      expect(resolve({ input })).toEqual({ error: UNRECOGNIZED_ERROR })
    }
  })
})

describe('workflow run target helpers', () => {
  it('reads a stored target back and rejects malformed ones', () => {
    expect(targetOf({ kind: 'run', repo: REPO, runId: 3 })).toEqual({
      kind: EWorkflowRunTargetKind.Run,
      repo: REPO,
      runId: 3,
    })
    expect(
      targetOf({ kind: 'selector', repo: REPO, workflow: 'deploy.yml', branch: 'main' }),
    ).toEqual({
      kind: EWorkflowRunTargetKind.Selector,
      repo: REPO,
      workflow: 'deploy.yml',
      branch: 'main',
    })

    for (const value of [
      null,
      [],
      'x',
      {},
      { repo: REPO, runId: 3 },
      { kind: 'run', repo: 'gitlab.com/a/b', runId: 3 },
      { kind: 'run', repo: REPO, runId: 0 },
      { kind: 'run', repo: REPO, runId: 1.5 },
      { kind: 'run', repo: REPO, runId: '3' },
      { kind: 'selector', repo: REPO, workflow: '', branch: 'main' },
      { kind: 'selector', repo: REPO, workflow: 'deploy.yml', branch: '' },
      { kind: 'watch', repo: REPO, runId: 3 },
    ]) {
      expect(targetOf(value)).toBeNull()
    }
  })

  it('reads a stored target with other casing back lowercase', () => {
    expect(targetOf({ kind: 'run', repo: 'GitHub.com/DLTech/Atlas', runId: 3 })).toEqual({
      kind: EWorkflowRunTargetKind.Run,
      repo: 'github.com/dltech/atlas',
      runId: 3,
    })
  })

  it('labels a pinned run with and without its workflow, and a selector', () => {
    const run = { kind: EWorkflowRunTargetKind.Run as const, repo: REPO, runId: 3 }

    expect(labelOf({ target: run })).toBe('dennisofficial/atlas#3')
    expect(labelOf({ target: run, workflow: 'Build' })).toBe('dennisofficial/atlas#3 \u00b7 Build')
    expect(labelOf({ target: SELECTOR().target })).toBe('dennisofficial/atlas deploy.yml@main')
    expect(labelOf({ target: { ...SELECTOR().target, repo: 'github.com/A/B' } })).toBe(
      'a/b deploy.yml@main',
    )
  })

  it('keys a run and a selector the way the link rows are keyed', () => {
    expect(targetKey({ kind: EWorkflowRunTargetKind.Run, repo: 'GitHub.com/A/B', runId: 3 })).toBe(
      'github.com/a/b#run:3',
    )
    expect(
      targetKey({
        kind: EWorkflowRunTargetKind.Selector,
        repo: 'GitHub.com/A/B',
        workflow: 'deploy.yml',
        branch: 'main',
      }),
    ).toBe('github.com/a/b#workflow:deploy.yml@main')
  })

  it('names the repository of a github.com checkout and of no other', () => {
    expect(workflowRunRepoOf(CHECKOUT)).toBe(REPO)
    expect(workflowRunRepoOf(aCheckout({ owner: 'DLTech' }))).toBe('github.com/dltech/atlas')
    expect(workflowRunRepoOf(aCheckout({ host: 'acme.ghe.com' }))).toBeNull()
    expect(workflowRunRepoOf(null)).toBeNull()
  })
})
