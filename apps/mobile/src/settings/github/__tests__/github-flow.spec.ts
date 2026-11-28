import { describe, expect, it } from 'bun:test'
import { EReturnResult } from '@dltech/atlas-core'

import { EGithubFlow, githubFlowOfReturn } from '../github-flow'

describe('githubFlowOfReturn', () => {
  it('finishes a connected browser return', () => {
    expect(githubFlowOfReturn({ result: EReturnResult.Connected })).toEqual({
      status: EGithubFlow.Idle,
    })
  })

  it('shows the reason GitHub refused a browser return', () => {
    expect(
      githubFlowOfReturn({ result: EReturnResult.Failed, reason: 'Permission denied' }),
    ).toEqual({
      status: EGithubFlow.Failed,
      message: 'Permission denied',
    })
  })

  it('provides a failure message when the callback has no reason', () => {
    expect(githubFlowOfReturn({ result: EReturnResult.Failed })).toEqual({
      status: EGithubFlow.Failed,
      message: 'GitHub access was refused',
    })
  })
})
