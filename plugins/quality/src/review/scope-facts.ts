import { EQualitySkipReason } from '@dltech/atlas-core'

import type { ScopeJob, UnitResult } from './scope-review'

export type QualityChangeKind = 'created' | 'edited'

export type QualityScopeFacts = {
  scopeId: string
  changeKind: QualityChangeKind
  scopeLines: number
  scopeBytes: number
  diffLines: number
  requestBytes: number
  classifierMs: number
  deadlineMissed: boolean
}

const lineCountOf = ({ text }: { text: string }): number =>
  text === '' ? 0 : text.split('\n').length

const requestBytesOf = ({ plan }: { plan: ScopeJob['plan'] }): number =>
  plan.units.reduce(
    (sum, unit) =>
      sum +
      Buffer.byteLength(unit.request.state, 'utf8') +
      Buffer.byteLength(JSON.stringify(unit.request.questions), 'utf8'),
    0,
  )

export const factsOf = (args: {
  job: ScopeJob
  results: readonly UnitResult[]
  classifierMs: number
}): QualityScopeFacts => {
  const after = args.job.scope.after ?? ''
  return {
    scopeId: args.job.scope.id,
    changeKind: args.job.scope.before === null ? 'created' : 'edited',
    scopeLines: lineCountOf({ text: after }),
    scopeBytes: Buffer.byteLength(after, 'utf8'),
    diffLines: lineCountOf({ text: args.job.scope.diff }),
    requestBytes: requestBytesOf({ plan: args.job.plan }),
    classifierMs: args.classifierMs,
    deadlineMissed: args.results.some(
      (result) => result.kind === 'failed' && result.reason === EQualitySkipReason.ReviewDeadline,
    ),
  }
}
