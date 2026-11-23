import { describe, expect, it } from 'bun:test'

import { EQualityReviewStatus, EQualitySkipReason } from '@dltech/atlas-core'

import { FILE, PROJECT, contextOf, createRig, policyNamed, recordsOf, scopeNamed } from './fixtures'

describe('switches off', () => {
  it('reviews nothing and touches no collaborator', async () => {
    const rig = createRig({ settings: {} })
    expect(await rig.review()).toEqual({ records: [], context: undefined })
    expect(rig.sourceCalls).toHaveLength(0)
    expect(rig.classifyCalls).toHaveLength(0)
  })
})

describe('workspace namespace', () => {
  it('stamps every record with the project directory the hook passed', async () => {
    const rig = createRig()
    const records = recordsOf(await rig.review())
    expect(records.length).toBeGreaterThan(0)
    for (const record of records) expect(record.workspaceNamespace).toBe(PROJECT)
    expect(rig.sourceCalls.every((args) => args.workspaceNamespace === PROJECT)).toBe(true)
  })
})

describe('coverage records', () => {
  it('turns capture faults into skipped records with the fault reason and no scope', async () => {
    const rig = createRig()
    const result = await rig.review({
      changes: [],
      captureFaults: [
        { path: FILE, reason: EQualitySkipReason.SourceUnavailable, detail: 'unreadable' },
      ],
    })
    const [record] = recordsOf(result)
    expect(recordsOf(result)).toHaveLength(1)
    expect(record).toMatchObject({
      status: EQualityReviewStatus.Skipped,
      reason: EQualitySkipReason.SourceUnavailable,
      detail: 'unreadable',
      path: 'src/a.ts',
    })
    expect(record?.scope).toBeUndefined()
    expect(rig.classifyCalls).toHaveLength(0)
  })

  it('turns preparation diagnostics into skipped records with no findings', async () => {
    const rig = createRig({
      scopes: [],
      skipped: [
        { path: 'src/a.ts', reason: EQualitySkipReason.InvalidSyntax, detail: 'parse error' },
      ],
    })
    const result = await rig.review()
    const [record] = recordsOf(result)
    expect(record).toMatchObject({
      status: EQualityReviewStatus.Skipped,
      reason: EQualitySkipReason.InvalidSyntax,
      findings: [],
    })
    expect(contextOf(result)).toBeUndefined()
  })

  it('rejects an outside-workspace path without calling the source adapter', async () => {
    const rig = createRig()
    const result = await rig.review({
      changes: [{ path: '/etc/passwd', before: null, after: 'x' }],
    })
    expect(recordsOf(result)[0]).toMatchObject({
      status: EQualityReviewStatus.Skipped,
      reason: EQualitySkipReason.OutsideWorkspace,
    })
    expect(rig.sourceCalls).toHaveLength(0)
    expect(rig.classifyCalls).toHaveLength(0)

    const parent = await rig.review({
      changes: [{ path: '../elsewhere/b.ts', before: null, after: 'x' }],
    })
    expect(recordsOf(parent)[0]?.reason).toBe(EQualitySkipReason.OutsideWorkspace)
  })
})

describe('regressions from review', () => {
  it('retires deleted scopes without a model call', async () => {
    const rig = createRig({ scopes: [scopeNamed({ after: null, afterHash: null })] })
    const result = await rig.review()
    const [record] = recordsOf(result)
    expect(record?.status).toBe(EQualityReviewStatus.Completed)
    expect(record?.detail).toBe('scope deleted')
    expect(rig.classifyCalls).toHaveLength(0)
    expect(contextOf(result)).toBeUndefined()
  })

  it('keeps a well-behaved policy selection when another policy duplicates a scope', async () => {
    const rig = createRig({
      policies: [
        policyNamed({ id: 'srp' }),
        policyNamed({ id: 'greedy', select: (ids) => [...ids, ...ids] }),
      ],
    })
    const records = recordsOf(await rig.review())
    expect(
      records.some((record) => record.reason === EQualitySkipReason.ScopeIdentityUncertain),
    ).toBe(true)
    const reviewed = records.find((record) => record.status === EQualityReviewStatus.Completed)
    expect(reviewed?.assessments.map((assessment) => assessment.policyId)).toEqual(['srp'])
  })

  it('turns a throwing selectScopes into a fault record instead of losing the call', async () => {
    const bad = policyNamed({ id: 'thrower' })
    bad.selectScopes = () => {
      throw new Error('policy bug')
    }
    const rig = createRig({ policies: [bad, policyNamed({ id: 'srp' })] })
    const records = recordsOf(await rig.review())
    expect(records.some((record) => record.detail?.includes('selectScopes threw'))).toBe(true)
    expect(records.some((record) => record.status === EQualityReviewStatus.Completed)).toBe(true)
  })
})
