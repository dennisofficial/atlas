import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'

import { qualityNoticeOf } from '@dltech/atlas-plugin-quality/core'
import {
  EQualityFindingState,
  EQualityImpact,
  EQualityReviewStatus,
  EQualitySkipReason,
  EQualityTransition,
  toCallId,
  type CodeQualityReviewedBody,
  type QualityAssessment,
  type QualityFinding,
} from '@dltech/atlas-core'

import { ECallState, type ToolCall, type ToolRun } from '../../../../store'
import { grammarsReady, teardown } from '../../../markdown/__tests__/harness'
import { ToolRunBlock } from '../tool-run-block'

await grammarsReady()

const WIDTH = 90

const HEIGHT = 12

const review = (overrides: Partial<CodeQualityReviewedBody> = {}): CodeQualityReviewedBody => ({
  type: 'code-quality-reviewed',
  callId: toCallId('call-1'),
  workspaceNamespace: 'local:workspace',
  path: 'src/widget.ts',
  beforeHash: 'before',
  afterHash: 'after',
  status: EQualityReviewStatus.Completed,
  assessments: [],
  findings: [],
  durationMs: 40,
  ...overrides,
})

const assessment = (overrides: Partial<QualityAssessment> = {}): QualityAssessment => ({
  policyId: 'single-responsibility',
  policyVersion: '1',
  scopeId: 'scope-1',
  status: EQualityReviewStatus.Completed,
  impact: EQualityImpact.Introduced,
  currentConcernProbability: 0.9,
  transition: EQualityTransition.Introduce,
  evidenceIds: [],
  rawAnswers: {},
  ...overrides,
})

const finding = (overrides: Partial<QualityFinding> = {}): QualityFinding => ({
  id: 'single-responsibility:scope-1:1',
  policyId: 'single-responsibility',
  scopeId: 'scope-1',
  episode: 1,
  state: EQualityFindingState.Active,
  notified: true,
  lastAfterHash: 'after',
  policyVersion: '1',
  ...overrides,
})

const call = (reviews: readonly CodeQualityReviewedBody[]): ToolCall => ({
  callId: toCallId('call-1'),
  name: 'write',
  input: { path: '/repo/src/widget.ts', content: 'export class Widget {}' },
  output: { path: '/repo/src/widget.ts', created: true, bytes: 24 },
  modelText: 'wrote widget.ts',
  state: ECallState.Ok,
  note: null,
  at: null,
  settledAt: '2026-10-08T00:00:00.000Z',
  attachments: [],
  qualityReviews: reviews,
})

const runOf = (toolCall: ToolCall): ToolRun => ({
  key: `tools:${toolCall.callId}`,
  openedBy: toolCall.callId,
  calls: [toolCall],
})

const render = async (toolCall: ToolCall) => {
  const setup = await testRender(
    <box flexDirection="column" width={WIDTH} height={HEIGHT}>
      <ToolRunBlock run={runOf(toolCall)} width={WIDTH} cwd="/repo" />
    </box>,
    { width: WIDTH, height: HEIGHT },
  )
  await setup.flush()
  return setup
}

describe('a tool row with a quality review attached', () => {
  it('shows the policy name beside a write that introduced a concern', async () => {
    const toolCall = call([review({ assessments: [assessment()], findings: [finding()] })])
    expect(qualityNoticeOf(toolCall.qualityReviews)?.findings).toBe(1)
    const setup = await render(toolCall)
    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain('widget.ts')
      expect(frame).toContain('Single responsibility')
    } finally {
      await teardown(setup)
    }
  })

  it('shows the failure beside a review that timed out', async () => {
    const setup = await render(
      call([
        review({
          status: EQualityReviewStatus.OperationalError,
          reason: EQualitySkipReason.ReviewDeadline,
        }),
      ]),
    )
    try {
      expect(setup.captureCharFrame()).toContain('review timed out')
    } finally {
      await teardown(setup)
    }
  })

  it('says nothing extra beside a clean write', async () => {
    const setup = await render(call([review()]))
    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain('widget.ts')
      expect(frame).not.toContain('Single responsibility')
      expect(frame).not.toContain('review')
    } finally {
      await teardown(setup)
    }
  })
})
