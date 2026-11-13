import { join } from 'node:path'

import type { RunId, ThreadId } from '@dltech/atlas-core'
import {
  EOperatorRequestKind,
  EOperatorRequestOutcome,
  OPERATOR_INPUT_ASKED,
  OPERATOR_INPUT_SETTLED,
  type OperatorInputAsked,
  type OperatorInputSettled,
} from '@dltech/atlas-plugin-operator/core'
import type {
  PodOperatorAsk,
  PodOperatorDelivery,
  PodOperatorInput,
} from '@dltech/atlas-plugin-sdk'
import { ECallFailure, ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import { newKey, type RemoteCalls } from '../calls/remote-calls'
import type {
  AwaitingOperator,
  OperatorRequestAnswer,
  OperatorRequestOpen,
  OperatorRequestPort,
} from './operator-requests'
import type { SessionRecord } from './record/record-adapter'

const REQUESTS_DIRECTORY = 'requests'
const REQUESTS_FILE_MODE = 0o600

export type OperatorInputArgs = {
  requests: OperatorRequestPort
  awaiting: AwaitingOperator
  sessionId: string
  threadId: ThreadId
  sessionDir: string
  calls: RemoteCalls
  record: SessionRecord
  newRunId: () => RunId
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const ABANDONED = 'abandoned'

const answerRaced = async (args: {
  answered: Promise<OperatorRequestAnswer>
  abandon: () => void
  signal: AbortSignal
}): Promise<OperatorRequestAnswer> => {
  if (args.signal.aborted) {
    args.abandon()
    return { ok: false, reason: ABANDONED }
  }
  return await new Promise<OperatorRequestAnswer>((resolve) => {
    const onAbort = (): void => {
      args.abandon()
      resolve({ ok: false, reason: ABANDONED })
    }
    args.signal.addEventListener('abort', onAbort, { once: true })
    void args.answered.then((answer) => {
      args.signal.removeEventListener('abort', onAbort)
      resolve(answer)
    })
  })
}

const answeredBodyOf = (args: {
  requestId: string
  outcome: EOperatorRequestOutcome
  sessionId: string
  path?: string | undefined
  bytes?: number | undefined
  reason?: string | undefined
}): OperatorInputSettled => ({
  type: OPERATOR_INPUT_SETTLED,
  requestId: args.requestId,
  outcome: args.outcome,
  ...(args.path === undefined ? {} : { path: args.path }),
  ...(args.bytes === undefined ? {} : { bytes: args.bytes }),
  ...(args.reason === undefined ? {} : { reason: args.reason }),
  sessionId: args.sessionId,
})

const outcomeOfRefusal = (reason: string): EOperatorRequestOutcome => {
  if (reason === 'expired') return EOperatorRequestOutcome.Expired
  if (reason === ABANDONED) return EOperatorRequestOutcome.Abandoned
  if (reason === 'cancelled') return EOperatorRequestOutcome.Cancelled
  return EOperatorRequestOutcome.Failed
}

export const operatorInputOf = (args: OperatorInputArgs): PodOperatorInput => {
  const invoke = (op: CallOp, signal: AbortSignal | undefined): Promise<CallResult> =>
    args.calls.invoke({ key: newKey(), op, signal })

  const append = async (body: OperatorInputAsked | OperatorInputSettled): Promise<void> => {
    await args.record.append({
      threadId: args.threadId,
      runId: args.newRunId(),
      drafts: [body],
    })
  }

  const settle = async (settled: Parameters<typeof answeredBodyOf>[0]): Promise<void> => {
    await append(answeredBodyOf(settled))
  }

  const deliverFile = async (args2: {
    requestId: string
    value: string
    signal: AbortSignal | undefined
  }): Promise<PodOperatorDelivery> => {
    const directory = join(args.sessionDir, REQUESTS_DIRECTORY)
    const path = join(directory, args2.requestId)
    const made = await invoke({ op: 'mkdir', path: directory }, args2.signal)
    if (made.status === ECallStatus.Failed && made.error.code !== ECallFailure.AlreadyExists)
      return {
        ok: false,
        reason: `the requests directory could not be created: ${made.error.message}`,
      }
    const written = await invoke(
      { op: 'writeFile', path, content: args2.value, mode: REQUESTS_FILE_MODE },
      args2.signal,
    )
    if (written.status === ECallStatus.Failed)
      return { ok: false, reason: `the value could not be written: ${written.error.message}` }
    return { ok: true, path, bytes: Buffer.byteLength(args2.value, 'utf8') }
  }

  const deliverShell = async (args2: {
    shellId: string
    value: string
    signal: AbortSignal | undefined
  }): Promise<PodOperatorDelivery> => {
    const written = await invoke(
      { op: 'shells.write', shellId: args2.shellId, data: args2.value, end: false },
      args2.signal,
    )
    if (written.status === ECallStatus.Failed)
      return {
        ok: false,
        reason: `the value could not be typed into the shell: ${written.error.message}`,
      }
    return { ok: true, shellId: args2.shellId, bytes: Buffer.byteLength(args2.value, 'utf8') }
  }

  const run = async (args2: {
    ask: PodOperatorAsk
    signal: AbortSignal
  }): Promise<PodOperatorDelivery> => {
    let opened: OperatorRequestOpen
    try {
      opened = await args.requests.open({
        sessionId: args.sessionId,
        threadId: args.threadId,
        ask: args2.ask,
      })
    } catch (error) {
      return { ok: false, reason: messageOf(error) }
    }

    await append({
      type: OPERATOR_INPUT_ASKED,
      requestId: opened.requestId,
      kind: args2.ask.kind === 'shell' ? EOperatorRequestKind.Shell : EOperatorRequestKind.Input,
      prompt: args2.ask.prompt,
      secret: args2.ask.secret,
      ...(args2.ask.kind === 'shell' ? { shellId: args2.ask.shellId } : {}),
      expiresAt: opened.expiresAt.toISOString(),
      sessionId: args.sessionId,
    })

    const answer = await answerRaced({
      answered: opened.answered,
      abandon: () => opened.abandon(ABANDONED),
      signal: args2.signal,
    })
    if (!answer.ok) {
      await settle({
        requestId: opened.requestId,
        outcome: outcomeOfRefusal(answer.reason),
        reason: answer.reason,
        sessionId: args.sessionId,
      })
      return { ok: false, reason: answer.reason }
    }

    const delivery =
      args2.ask.kind === 'shell'
        ? await deliverShell({
            shellId: args2.ask.shellId,
            value: answer.value,
            signal: args2.signal,
          })
        : await deliverFile({
            requestId: opened.requestId,
            value: answer.value,
            signal: args2.signal,
          })

    if (!delivery.ok) {
      await settle({
        requestId: opened.requestId,
        outcome: EOperatorRequestOutcome.Failed,
        reason: delivery.reason,
        sessionId: args.sessionId,
      })
      return delivery
    }
    await settle({
      requestId: opened.requestId,
      outcome: EOperatorRequestOutcome.Delivered,
      ...('path' in delivery ? { path: delivery.path } : {}),
      bytes: delivery.bytes,
      sessionId: args.sessionId,
    })
    return delivery
  }

  return {
    ask: async (args2) => {
      const release = args.awaiting.begin()
      try {
        return await run(args2)
      } finally {
        release()
      }
    },
  }
}
