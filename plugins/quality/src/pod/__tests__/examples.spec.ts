import { describe, expect, it } from 'bun:test'

import {
  EQualityFindingState,
  EQualityImpact,
  EQualityLanguage,
  EQualityReviewStatus,
  EQualityScopeKind,
  EQualityTransition,
  type CodeQualityReviewedBody,
  type QualityAssessment,
  type QualityFinding,
} from '@dltech/atlas-core'

import type { FlaggedExample } from '../../review/engine'
import { policyNamed, scopeNamed } from '../../review/__tests__/fixtures'
import {
  MAX_EXAMPLE_EXCERPT_CHARS,
  QUALITY_EXAMPLE_FLAGGED,
  exampleFlaggedProperties,
} from '../analytics/example-properties'
import { CALL, PROJECT, analyticsRecorder, change, createRig, wroteWithChanges } from './support'

const ASSESSMENT: QualityAssessment = {
  policyId: 'single-responsibility',
  policyVersion: '1',
  scopeId: 'scope-1',
  status: EQualityReviewStatus.Completed,
  impact: EQualityImpact.Introduced,
  currentConcernProbability: 0.9,
  transition: EQualityTransition.Introduce,
  evidenceIds: [],
  rawAnswers: {},
}

const FINDING: QualityFinding = {
  id: 'single-responsibility:scope-1:1',
  policyId: 'single-responsibility',
  scopeId: 'scope-1',
  episode: 1,
  state: EQualityFindingState.Active,
  notified: true,
  lastAfterHash: 'a1',
  policyVersion: '1',
}

const RECORD: CodeQualityReviewedBody = {
  type: 'code-quality-reviewed',
  callId: CALL,
  workspaceNamespace: PROJECT,
  path: 'src/widget.ts',
  status: EQualityReviewStatus.Completed,
  beforeHash: null,
  afterHash: 'a1',
  assessments: [ASSESSMENT],
  findings: [FINDING],
  durationMs: 5,
}

const flaggedOf = (args: { path?: string; after?: string | null } = {}): FlaggedExample => {
  const path = args.path ?? RECORD.path
  return {
    record: { ...RECORD, path },
    entry: {
      finding: FINDING,
      assessment: ASSESSMENT,
      scope: scopeNamed({ path, ...(args.after === undefined ? {} : { after: args.after }) }),
      policy: policyNamed({ id: 'single-responsibility' }),
    },
  }
}

describe('exampleFlaggedProperties', () => {
  it('reports the finding, its scope and the excerpt', () => {
    expect(
      exampleFlaggedProperties({
        example: flaggedOf(),
        projectDirectory: PROJECT,
        classifierModel: 'jev-latest',
      }),
    ).toEqual({
      policy_id: 'single-responsibility',
      policy_version: '1',
      status: EQualityReviewStatus.Completed,
      impact: EQualityImpact.Introduced,
      transition: EQualityTransition.Introduce,
      concern_score: 0.9,
      finding_id: 'single-responsibility:scope-1:1',
      episode: 1,
      path: 'src/widget.ts',
      scope_name: 'Widget',
      scope_kind: EQualityScopeKind.Class,
      language: EQualityLanguage.TypeScript,
      line_start: 1,
      line_end: 10,
      excerpt: 'class Widget { run() {} }',
      excerpt_truncated: false,
      classifier_model: 'jev-latest',
    })
  })

  it('makes the path relative to the project directory', () => {
    const properties = exampleFlaggedProperties({
      example: flaggedOf({ path: `${PROJECT}/src/widget.ts` }),
      projectDirectory: PROJECT,
      classifierModel: 'jev-latest',
    })

    expect(properties?.path).toBe('src/widget.ts')
  })

  it('cuts a long excerpt and says so', () => {
    const properties = exampleFlaggedProperties({
      example: flaggedOf({ after: 'x'.repeat(MAX_EXAMPLE_EXCERPT_CHARS + 1) }),
      projectDirectory: PROJECT,
      classifierModel: 'jev-latest',
    })

    expect(properties?.excerpt).toBe('x'.repeat(MAX_EXAMPLE_EXCERPT_CHARS))
    expect(properties?.excerpt_truncated).toBe(true)
  })

  it('says nothing for a secret shaped path', () => {
    expect(
      exampleFlaggedProperties({
        example: flaggedOf({ path: `${PROJECT}/.env.production` }),
        projectDirectory: PROJECT,
        classifierModel: 'jev-latest',
      }),
    ).toBeNull()
  })

  it('says nothing when the excerpt names a secret literal', () => {
    expect(
      exampleFlaggedProperties({
        example: flaggedOf({ after: 'const token = "sk-abcdefgh1234"' }),
        projectDirectory: PROJECT,
        classifierModel: 'jev-latest',
      }),
    ).toBeNull()
  })
})

describe('the example event through the after-tool hook', () => {
  it('sends one event for a flagged finding when examples are on', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics, settings: { enabled: true, policies: {}, examples: true } })

    await rig.run()

    const examples = captured.filter((entry) => entry.event === QUALITY_EXAMPLE_FLAGGED)
    expect(examples).toHaveLength(1)
    expect(examples[0]?.properties).toMatchObject({
      policy_id: 'single-responsibility',
      path: 'src/widget.ts',
      excerpt: expect.stringContaining('audit()'),
      excerpt_truncated: false,
    })
  })

  it('sends none when examples are off', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    await rig.run()

    expect(captured.filter((entry) => entry.event === QUALITY_EXAMPLE_FLAGGED)).toEqual([])
  })

  it('sends none for a secret shaped path', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics, settings: { enabled: true, policies: {}, examples: true } })

    await rig.run({
      result: wroteWithChanges({ fileChanges: [{ ...change, path: `${PROJECT}/.env.local` }] }),
    })

    expect(captured.filter((entry) => entry.event === QUALITY_EXAMPLE_FLAGGED)).toEqual([])
  })
})
