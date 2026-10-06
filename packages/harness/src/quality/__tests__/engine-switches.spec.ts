import { describe, expect, it } from 'bun:test'

import { EQualityReviewStatus, EQualitySkipReason, type QualityScope } from '@dltech/atlas-core'

import type { QualityExampleSink } from '../example-sink'
import { FILE, createRig, nudgesOf, policyNamed, recordsOf, scopeNamed } from './fixtures'

type Sink = Pick<QualityExampleSink, 'record'>

function recordingSink({ fail = false }: { fail?: boolean } = {}): { sink: Sink; scopes: QualityScope[] } {
  const scopes: QualityScope[] = []
  const sink: Sink = {
    record: async (args) => {
      scopes.push(args.scope)
      return fail ? { ok: false, fault: 'disk full' } : { ok: true, relativePath: `threads/t/quality/examples/${args.scope.id}.json` }
    },
  }
  return { sink, scopes }
}

describe('switches off', () => {
  it('reviews nothing and touches no collaborator', async () => {
    const rig = createRig({ settings: {} })
    expect(rig.engine.captureEnabled()).toBe(false)
    expect(await rig.review()).toEqual([])
    expect(rig.sourceCalls).toHaveLength(0)
    expect(rig.identityCalls).toHaveLength(0)
    expect(rig.decisionCalls).toHaveLength(0)
  })

  it('reports capture enabled for either switch', () => {
    expect(createRig({ settings: { 'quality.enabled': true } }).engine.captureEnabled()).toBe(true)
    expect(createRig({ settings: { 'quality.recordExamples': true } }).engine.captureEnabled()).toBe(true)
  })
})

describe('record-only mode', () => {
  it('records examples for selected scopes only, with no decision call and no nudge', async () => {
    const { sink, scopes } = recordingSink()
    const rig = createRig({
      settings: { 'quality.recordExamples': true },
      policies: [policyNamed({ select: () => ['scope-1'] })],
      scopes: [scopeNamed(), scopeNamed({ id: 'scope-2', name: 'Other' })],
      examples: sink,
    })
    const drafts = await rig.review()

    expect(scopes.map((scope) => scope.id)).toEqual(['scope-1'])
    expect(rig.decisionCalls).toHaveLength(0)
    expect(nudgesOf(drafts)).toHaveLength(0)
    const [record] = recordsOf(drafts)
    expect(drafts).toHaveLength(1)
    expect(record?.status).toBe(EQualityReviewStatus.Skipped)
    expect(record?.reason).toBe(EQualitySkipReason.Disabled)
    expect(record?.evidencePath).toBe('threads/t/quality/examples/scope-1.json')
  })

  it('surfaces a recording fault without failing the review', async () => {
    const rig = createRig({ settings: { 'quality.recordExamples': true }, examples: recordingSink({ fail: true }).sink })
    const [record] = recordsOf(await rig.review())
    expect(record?.reason).toBe(EQualitySkipReason.Disabled)
    expect(record?.detail).toBe('disk full')
    expect(record?.evidencePath).toBeUndefined()
  })

  it('records a separate diagnostic when recording fails alongside an enabled review', async () => {
    const rig = createRig({
      settings: { 'quality.enabled': true, 'quality.recordExamples': true },
      examples: recordingSink({ fail: true }).sink,
    })
    const drafts = await rig.review()
    const records = recordsOf(drafts)
    expect(records.map((record) => record.status).sort()).toEqual([EQualityReviewStatus.Completed, EQualityReviewStatus.OperationalError])
    expect(records.find((record) => record.status === EQualityReviewStatus.Completed)?.evidencePath).toBeUndefined()
    expect(nudgesOf(drafts)).toHaveLength(1)
  })

  it('attaches the evidence path to the reviewed record when recording succeeds', async () => {
    const rig = createRig({
      settings: { 'quality.enabled': true, 'quality.recordExamples': true },
      examples: recordingSink().sink,
    })
    const [record] = recordsOf(await rig.review())
    expect(record?.evidencePath).toBe('threads/t/quality/examples/scope-1.json')
  })
})

describe('coverage records', () => {
  it('turns capture faults into skipped records with the fault reason and no scope', async () => {
    const rig = createRig()
    const drafts = await rig.review({
      changes: [],
      captureFaults: [{ path: FILE, reason: EQualitySkipReason.SourceUnavailable, detail: 'unreadable' }],
    })
    const [record] = recordsOf(drafts)
    expect(drafts).toHaveLength(1)
    expect(record).toMatchObject({ status: EQualityReviewStatus.Skipped, reason: EQualitySkipReason.SourceUnavailable, detail: 'unreadable', path: 'src/a.ts' })
    expect(record?.scope).toBeUndefined()
    expect(rig.decisionCalls).toHaveLength(0)
  })

  it('turns preparation diagnostics into skipped records with no findings', async () => {
    const rig = createRig({
      scopes: [],
      skipped: [{ path: 'src/a.ts', reason: EQualitySkipReason.InvalidSyntax, detail: 'parse error' }],
    })
    const drafts = await rig.review()
    const [record] = recordsOf(drafts)
    expect(record).toMatchObject({ status: EQualityReviewStatus.Skipped, reason: EQualitySkipReason.InvalidSyntax, findings: [] })
    expect(nudgesOf(drafts)).toHaveLength(0)
  })

  it('rejects an outside-workspace path without calling the source adapter', async () => {
    const rig = createRig()
    const drafts = await rig.review({ changes: [{ path: '/etc/passwd', before: null, after: 'x' }] })
    expect(recordsOf(drafts)[0]).toMatchObject({ status: EQualityReviewStatus.Skipped, reason: EQualitySkipReason.OutsideWorkspace })
    expect(rig.sourceCalls).toHaveLength(0)
    expect(rig.decisionCalls).toHaveLength(0)

    const parent = await rig.review({ changes: [{ path: '../elsewhere/b.ts', before: null, after: 'x' }] })
    expect(recordsOf(parent)[0]?.reason).toBe(EQualitySkipReason.OutsideWorkspace)
  })

  it('records WorkspaceUnidentified once per change when identity throws, never inventing one', async () => {
    const rig = createRig({
      identify: async () => {
        throw new Error('git probe failed')
      },
    })
    const drafts = await rig.review({
      changes: [
        { path: FILE, before: null, after: 'x' },
        { path: '/repo/src/b.ts', before: null, after: 'y' },
      ],
    })
    const records = recordsOf(drafts)
    expect(records).toHaveLength(2)
    for (const record of records) {
      expect(record).toMatchObject({ status: EQualityReviewStatus.OperationalError, reason: EQualitySkipReason.WorkspaceUnidentified })
    }
    expect(rig.identityCalls).toHaveLength(1)
    expect(rig.sourceCalls).toHaveLength(0)
    expect(nudgesOf(drafts)).toHaveLength(0)
  })

  it('asks for the namespace once per review, passing the thread and project', async () => {
    const rig = createRig()
    await rig.review({ changes: [{ path: FILE, before: null, after: 'x' }, { path: '/repo/src/b.ts', before: null, after: 'y' }] })
    expect(rig.identityCalls).toHaveLength(1)
    expect(rig.identityCalls[0]).toMatchObject({ projectDirectory: '/repo' })
    expect(rig.sourceCalls.every((args) => args.workspaceNamespace === 'git@host:org/repo.git#.')).toBe(true)
  })
})

describe('regressions from review', () => {
  it('retires deleted scopes in record-only mode without a model call', async () => {
    const rig = createRig({
      settings: { 'quality.recordExamples': true },
      scopes: [scopeNamed({ after: null, afterHash: null })],
    })
    const drafts = await rig.review()
    const [record] = recordsOf(drafts)
    expect(record?.status).toBe(EQualityReviewStatus.Completed)
    expect(record?.detail).toBe('scope deleted')
    expect(rig.decisionCalls).toHaveLength(0)
    expect(nudgesOf(drafts)).toHaveLength(0)
  })

  it('keeps a well-behaved policy selection when another policy duplicates a scope', async () => {
    const rig = createRig({
      policies: [
        policyNamed({ id: 'srp' }),
        policyNamed({ id: 'greedy', select: (ids) => [...ids, ...ids] }),
      ],
    })
    const drafts = await rig.review()
    const records = recordsOf(drafts)
    expect(records.some((record) => record.reason === EQualitySkipReason.ScopeIdentityUncertain)).toBe(true)
    const reviewed = records.find((record) => record.status === EQualityReviewStatus.Completed)
    expect(reviewed?.assessments.map((assessment) => assessment.policyId)).toEqual(['srp'])
  })

  it('turns a throwing selectScopes into a fault record instead of losing the call', async () => {
    const bad = policyNamed({ id: 'thrower' })
    bad.selectScopes = () => {
      throw new Error('policy bug')
    }
    const rig = createRig({ policies: [bad, policyNamed({ id: 'srp' })] })
    const drafts = await rig.review()
    const records = recordsOf(drafts)
    expect(records.some((record) => record.detail?.includes('selectScopes threw'))).toBe(true)
    expect(records.some((record) => record.status === EQualityReviewStatus.Completed)).toBe(true)
  })

  it('records a ReviewDeadline operational error when the identity probe exceeds the budget', async () => {
    const rig = createRig({
      deadlineMs: 20,
      identify: () => new Promise(() => {}),
    })
    const drafts = await rig.review()
    const [record] = recordsOf(drafts)
    expect(record).toMatchObject({ status: EQualityReviewStatus.OperationalError, reason: EQualitySkipReason.ReviewDeadline })
  })
})
