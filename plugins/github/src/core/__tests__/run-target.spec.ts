import { describe, expect, it } from 'bun:test'

import {
  BAD_RUN_ID_ERROR,
  NO_RUN_REPOSITORY_ERROR,
  parseRunTargetInput,
  runLabelOf,
  runSelectorOf,
  runTargetKey,
  runTargetOf,
  runTargetOfSelector,
  sameRunTarget,
  UNRECOGNIZED_RUN_ERROR,
  workflowNameOf,
} from '../run-target'

const REPO = 'github.com/dltech/atlas'

describe('parseRunTargetInput', () => {
  it('reads a blank target as the run for this push', () => {
    expect(parseRunTargetInput('')).toEqual({ kind: 'current' })
    expect(parseRunTargetInput('   ')).toEqual({ kind: 'current' })
  })

  it('reads a bare or hashed id as a run in the checkout repository', () => {
    expect(parseRunTargetInput('#33522901117')).toEqual({ kind: 'run', runId: 33522901117 })
    expect(parseRunTargetInput('33522901117')).toEqual({ kind: 'run', runId: 33522901117 })
  })

  it('reads owner/repo#id as a run anywhere, lowercased', () => {
    expect(parseRunTargetInput('Dltech/Atlas#42')).toEqual({
      kind: 'run',
      repo: REPO,
      runId: 42,
    })
  })

  it('reads a run url with a job path, a query or a fragment', () => {
    for (const url of [
      'https://github.com/dltech/atlas/actions/runs/42',
      'https://github.com/dltech/atlas/actions/runs/42/job/7',
      'https://github.com/dltech/atlas/actions/runs/42?check_suite_focus=true',
      'http://github.com/dltech/atlas/actions/runs/42#logs',
      'https://github.com/dltech/atlas/actions/runs/42/',
    ]) {
      expect(parseRunTargetInput(url)).toEqual({ kind: 'run', repo: REPO, runId: 42 })
    }
  })

  it('reads workflow@branch as a selector on that branch', () => {
    expect(parseRunTargetInput('deploy.yml@main')).toEqual({
      kind: 'selector',
      workflow: 'deploy.yml',
      branch: 'main',
    })
    expect(parseRunTargetInput('Deploy@release/2.0')).toEqual({
      kind: 'selector',
      workflow: 'deploy.yml',
      branch: 'release/2.0',
    })
    expect(parseRunTargetInput('.github/workflows/deploy.yml@main')).toEqual({
      kind: 'selector',
      workflow: '.github/workflows/deploy.yml',
      branch: 'main',
    })
  })

  it('reads a workflow alone as a selector whose branch the checkout decides', () => {
    expect(parseRunTargetInput('deploy.yml')).toEqual({
      kind: 'selector',
      workflow: 'deploy.yml',
    })
  })

  it('refuses a zero id in every form', () => {
    for (const input of ['#0', '0', 'dltech/atlas#0']) {
      expect(parseRunTargetInput(input)).toEqual({ kind: 'error', error: BAD_RUN_ID_ERROR })
    }
  })

  it('refuses an empty branch after the at sign', () => {
    expect(parseRunTargetInput('deploy.yml@')).toEqual({
      kind: 'error',
      error: UNRECOGNIZED_RUN_ERROR,
    })
  })

  it('refuses anything else, including pull request references', () => {
    for (const input of [
      'https://github.com/dltech/atlas/pull/42',
      'dltech/atlas#42#3',
      'main',
      'deploy',
    ]) {
      expect(parseRunTargetInput(input)).toEqual({ kind: 'error', error: UNRECOGNIZED_RUN_ERROR })
    }
  })
})

describe('workflowNameOf', () => {
  it('keeps a dotted name and appends the yml extension to a bare one', () => {
    expect(workflowNameOf('deploy.yml')).toBe('deploy.yml')
    expect(workflowNameOf('Deploy.YAML')).toBe('deploy.yaml')
    expect(workflowNameOf('Deploy')).toBe('deploy.yml')
    expect(workflowNameOf('.github/workflows/deploy')).toBe('.github/workflows/deploy.yml')
  })
})

describe('runTargetOf', () => {
  it('reads the pinned run shape the provider and the API share', () => {
    expect(runTargetOf({ kind: 'run', repo: REPO, runId: 42 })).toEqual({
      kind: 'run',
      repo: REPO,
      runId: 42,
    })
  })

  it('reads the selector shape', () => {
    expect(
      runTargetOf({ kind: 'selector', repo: REPO, workflow: 'deploy.yml', branch: 'main' }),
    ).toEqual({ kind: 'selector', repo: REPO, workflow: 'deploy.yml', branch: 'main' })
  })

  it('refuses a foreign host, a missing kind and a bad id', () => {
    for (const value of [
      null,
      [],
      {},
      { kind: 'run', repo: 'https://gitlab.com/o/r', runId: 1 },
      { kind: 'run', repo: REPO, runId: 0 },
      { kind: 'run', repo: REPO, runId: 1.5 },
      { kind: 'selector', repo: REPO, workflow: '', branch: 'main' },
      { kind: 'selector', repo: REPO, workflow: 'deploy.yml', branch: 3 },
      { kind: 'other', repo: REPO },
    ]) {
      expect(runTargetOf(value)).toBeNull()
    }
  })
})

describe('labels and keys', () => {
  const pinned = { kind: 'run', repo: REPO, runId: 42 } as const
  const selector = {
    kind: 'selector',
    repo: REPO,
    workflow: 'deploy.yml',
    branch: 'main',
  } as const

  it('names a pinned run by repository and id, and a selector by workflow and branch', () => {
    expect(runLabelOf(pinned)).toBe('dltech/atlas#42')
    expect(runLabelOf(selector)).toBe('dltech/atlas deploy.yml@main')
  })

  it('writes the branch-column selector the API rows carry', () => {
    expect(runSelectorOf(pinned)).toBe('#run:42')
    expect(runSelectorOf(selector)).toBe('#workflow:deploy.yml@main')
  })

  it('round-trips a selector back to its target', () => {
    for (const target of [pinned, selector]) {
      expect(runTargetOfSelector({ repo: REPO, selector: runSelectorOf(target) })).toEqual(target)
    }
  })

  it('refuses a selector it cannot read', () => {
    for (const selector of ['#run:', '#workflow:deploy.yml', 'main', '#42']) {
      expect(runTargetOfSelector({ repo: REPO, selector })).toBeNull()
    }
  })

  it('keys the two forms apart and compares them', () => {
    expect(runTargetKey(pinned)).toBe('github.com/dltech/atlas#run:42')
    expect(runTargetKey(selector)).toBe('github.com/dltech/atlas#workflow:deploy.yml@main')
    expect(sameRunTarget(pinned, { kind: 'run', repo: REPO, runId: 42 })).toBe(true)
    expect(sameRunTarget(pinned, selector)).toBe(false)
  })
})

describe('the reference nothing can resolve', () => {
  it('tells the agent what to pass instead', () => {
    expect(NO_RUN_REPOSITORY_ERROR).toContain('owner/repo#<run id>')
  })
})
