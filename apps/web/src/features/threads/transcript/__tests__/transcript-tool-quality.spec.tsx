import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import {
  EQualityFindingState,
  EQualityImpact,
  EQualityReviewStatus,
  EQualitySkipReason,
  EQualityTransition,
  toCallId,
  type CodeQualityReviewedBody,
} from '@dltech/atlas-core'
import { EToolKind, EToolState } from '@dltech/atlas-ui/ai/tool'

import type { ToolCallItem } from '../../data/transcript-items'
import { ToolRow } from '../transcript-tool-row'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(() => {
  document.body.innerHTML = ''
})

const mount = async (element: React.ReactElement) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(element)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const review = (overrides: Partial<CodeQualityReviewedBody> = {}): CodeQualityReviewedBody => ({
  type: 'code-quality-reviewed',
  callId: toCallId('c1'),
  workspaceNamespace: 'local:workspace',
  path: 'src/a.ts',
  beforeHash: 'before',
  afterHash: 'after',
  status: EQualityReviewStatus.Completed,
  assessments: [],
  findings: [],
  durationMs: 40,
  ...overrides,
})

const introduced = review({
  assessments: [
    {
      policyId: 'single-responsibility',
      policyVersion: '1',
      scopeId: 'scope-1',
      status: EQualityReviewStatus.Completed,
      impact: EQualityImpact.Introduced,
      currentConcernProbability: 0.9,
      transition: EQualityTransition.Introduce,
      evidenceIds: [],
      rawAnswers: {},
    },
  ],
  findings: [
    {
      id: 'single-responsibility:scope-1:1',
      policyId: 'single-responsibility',
      scopeId: 'scope-1',
      episode: 1,
      state: EQualityFindingState.Active,
      notified: true,
      lastAfterHash: 'after',
      policyVersion: '1',
    },
  ],
})

const timedOut = review({
  status: EQualityReviewStatus.OperationalError,
  reason: EQualitySkipReason.ReviewDeadline,
})

const call = (reviews: readonly CodeQualityReviewedBody[]): ToolCallItem => ({
  id: 'c1',
  kind: EToolKind.Read,
  state: EToolState.Done,
  label: 'src/a.ts',
  qualityReviews: reviews,
})

describe('a tool row with a quality review attached', () => {
  it('shows the policy name beside a write that introduced a concern', async () => {
    await mount(<ToolRow call={call([introduced])} onOpenChanges={null} />)

    expect(document.body.textContent).toContain('Single responsibility')
    expect(document.body.querySelector('.text-warning')).not.toBeNull()
  })

  it('shows the failure beside a review that timed out', async () => {
    await mount(<ToolRow call={call([timedOut])} onOpenChanges={null} />)

    expect(document.body.textContent).toContain('review timed out')
    expect(document.body.querySelector('.text-destructive')).not.toBeNull()
    expect(document.body.querySelector('.text-warning')).toBeNull()
  })

  it('says nothing extra beside a clean write', async () => {
    await mount(<ToolRow call={call([review()])} onOpenChanges={null} />)

    expect(document.body.textContent).toContain('src/a.ts')
    expect(document.body.textContent).not.toContain('Single responsibility')
    expect(document.body.textContent).not.toContain('review')
  })
})
