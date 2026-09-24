import { describe, expect, it } from 'vitest'
import { implementerInstructions, reviewerInstructions, stationSpawnMessageFor } from './station-prompt'
import { EStationKind } from './station.types'

const ARGS = { workItemId: 'fwi_1', runId: 'fsr_abc', repo: 'compai/atlas' }

describe('implementerInstructions', () => {
  it('teaches the git-token tool, the branch rule, and the result tool for this run', () => {
    const text = implementerInstructions(ARGS)
    expect(text).toContain('factory_git_token')
    expect(text).toContain('factory_submit_result')
    expect(text).toContain('atlas-factory/')
    expect(text).toContain('main')
    expect(text).toContain('head_sha')
    expect(text).toContain('compai/atlas')
  })

  it('teaches tools, never curl', () => {
    expect(implementerInstructions(ARGS)).not.toContain('curl')
    expect(reviewerInstructions(ARGS)).not.toContain('curl')
  })

  it('carries the run id so the control plane can use it as the delivery marker', () => {
    expect(implementerInstructions(ARGS)).toContain('fsr_abc')
  })

  it('teaches publishing through createCommitOnBranch so commits come back verified', () => {
    const text = implementerInstructions(ARGS)
    expect(text).toContain('createCommitOnBranch')
    expect(text).toContain('api.github.com/graphql')
    expect(text).toContain('expectedHeadOid')
    expect(text).toContain('verified')
  })

  it('teaches creating the branch ref before the first push', () => {
    const text = implementerInstructions(ARGS)
    expect(text).toContain('/git/refs')
    expect(text).toContain('refs/heads/')
  })

  it('teaches squashing every push into one commit and syncing the checkout to the remote head', () => {
    const text = implementerInstructions(ARGS)
    expect(text).toContain('one commit')
    expect(text).toContain('reset --hard')
  })

  it('teaches the stale-head failure and the unsigned-push fallback', () => {
    const text = implementerInstructions(ARGS)
    expect(text).toContain('STALE_DATA')
    expect(text).toContain('git push')
  })

  it('does not teach git push as the way to publish the branch', () => {
    const text = implementerInstructions(ARGS)
    expect(text).not.toContain('To fetch or push')
  })
})

describe('reviewerInstructions', () => {
  it('teaches the read-only snapshot, the head-sha check, and the verdict tool', () => {
    const text = reviewerInstructions(ARGS)
    expect(text).toContain('read-only snapshot')
    expect(text).toContain('factory_submit_result')
    expect(text).toContain('fsr_abc')
    expect(text).toContain('request_changes')
    expect(text).toContain('head SHA')
  })
})

describe('stationSpawnMessageFor', () => {
  it('appends the orchestrator message after the instructions', () => {
    const text = stationSpawnMessageFor({ ...ARGS, kind: EStationKind.Implementer, message: 'implement the thing verbatim' })
    const [instructions, message] = text.split('\n---\n')
    expect(instructions).toContain('implementer station')
    expect(message).toContain('implement the thing verbatim')
  })
})
