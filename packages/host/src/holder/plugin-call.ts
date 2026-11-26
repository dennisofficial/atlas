import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { CallInterruptedError, planStep } from '@dltech/atlas-core'
import { ECallFailure, ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import {
  claimStepSlot,
  nextKey,
  readKey,
  rememberRecordedSteps,
  scopeConsumedKeys,
  scopeDispatchedBootId,
  scopeKey,
  scopeNextSlot,
  scopeRecordedSteps,
} from '../calls/call-scope'
import { isReadOnlyOp } from '../calls/errors'
import { wasHandedOff } from '../calls/remote-calls-frames'
import type { StepEvent } from '../calls/step-detach'
import { stepDigestOf } from '../calls/step-digest'
import { POD_WAIT_INTERRUPTED, type WorkspaceGate } from '../calls/workspace-gate'
import type { RecordedStep, StepRecord } from './record/call-steps'

export type PluginSteps = {
  recorded(scopeKey: string): readonly RecordedStep[]
  record(step: StepRecord): Promise<void>
}

type PlannedCall = {
  key: string
  replayed: boolean
  bootId?: string | undefined
  read: boolean
  step: boolean
  scopeKey?: string | undefined
}

const ackRead = (args: Parameters<typeof pluginCallOf>[0], key: string): void => {
  Promise.resolve()
    .then(() => args.ack?.(key))
    .catch(() => undefined)
}

export const pluginCallOf = (args: {
  invoke: (call: {
    key: string
    op: CallOp
    signal?: AbortSignal | undefined
    onOutput?: ((bytes: Uint8Array) => void) | undefined
    detachOnHandoff?: boolean | undefined
    dispatchedBootId?: string | undefined
    replayed?: boolean | undefined
  }) => Promise<CallResult>
  env?: (() => Promise<Record<string, string>>) | undefined
  gate?: WorkspaceGate | undefined
  steps?: PluginSteps | undefined
  bootId?: (() => string | undefined) | undefined
  ack?: ((key: string) => Promise<unknown>) | undefined
  onStep?: ((event: StepEvent) => void) | undefined
}): PluginPodContext['call'] => {
  const withEnv = async (op: CallOp): Promise<CallOp> => {
    if (op.op !== 'exec' || args.env === undefined) return op
    return { ...op, env: { ...(await args.env()), ...op.env } }
  }
  const gateOf = async (
    op: CallOp,
    signal: AbortSignal | undefined,
  ): Promise<CallResult | null> => {
    if (args.gate === undefined) return null
    const outcome = await args.gate.wait(signal)
    if (outcome.state === 'prepared') return null
    if (outcome.state === 'aborted') {
      throw new CallInterruptedError({ message: POD_WAIT_INTERRUPTED })
    }
    return {
      status: ECallStatus.Failed,
      op: op.op,
      error: { code: ECallFailure.Internal, message: outcome.message },
    }
  }
  const freshCallOf = (op: CallOp): PlannedCall => {
    if (!isReadOnlyOp(op.op)) return { key: nextKey(), replayed: false, read: false, step: false }
    return { key: readKey(), replayed: false, read: true, step: false }
  }
  const planOf = async (op: CallOp): Promise<PlannedCall> => {
    const scope = scopeKey()
    if (scope === undefined || args.steps === undefined) return freshCallOf(op)
    if (isReadOnlyOp(op.op)) return freshCallOf(op)
    const recorded: readonly RecordedStep[] =
      scopeRecordedSteps() ?? (await args.steps.recorded(scope))
    rememberRecordedSteps(recorded)
    const digest = stepDigestOf(op)
    const plan = planStep({
      scopeKey: scope,
      recorded,
      consumed: scopeConsumedKeys() ?? new Set<string>(),
      op: op.op,
      digest,
      nextSlot: scopeNextSlot(),
    })
    claimStepSlot({ key: plan.key, index: plan.index })
    args.onStep?.({ kind: 'in-flight', scopeKey: scope, stepKey: plan.key })
    if (plan.kind === 'append') {
      await args.steps.record({
        key: plan.key,
        op: op.op,
        digest,
        ...(args.bootId?.() === undefined ? {} : { bootId: args.bootId() }),
      })
      return { key: plan.key, replayed: false, read: false, step: true, scopeKey: scope }
    }
    const step = recorded.find((fact) => fact.key === plan.key)
    const bootId = step?.bootId ?? scopeDispatchedBootId()
    return {
      key: plan.key,
      replayed: true,
      ...(bootId === undefined ? {} : { bootId }),
      read: false,
      step: true,
      scopeKey: scope,
    }
  }
  return async (op, options) => {
    const refused = await gateOf(op, options?.signal)
    if (refused !== null) return refused
    const planned = await planOf(op)
    let handedOff = false
    try {
      const result = await args.invoke({
        key: planned.key,
        op: await withEnv(op),
        signal: options?.signal,
        onOutput: options?.onOutput,
        detachOnHandoff: planned.step,
        ...(planned.replayed ? { replayed: true } : {}),
        ...(planned.bootId === undefined ? {} : { dispatchedBootId: planned.bootId }),
      })
      handedOff = wasHandedOff(result)
      return result
    } finally {
      if (planned.read) ackRead(args, planned.key)
      if (planned.step && planned.scopeKey !== undefined) {
        args.onStep?.({
          kind: 'settled',
          scopeKey: planned.scopeKey,
          stepKey: planned.key,
          handedOff,
        })
      }
    }
  }
}
