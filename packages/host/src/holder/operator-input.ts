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
import type { PodOperatorDelivery, PodOperatorInput } from '@dltech/atlas-plugin-sdk'
import { ECallFailure, ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import { newKey, type RemoteCalls } from '../calls/remote-calls'
import type {
  OperatorRequestAnswer,
  OperatorRequestOpen,
  OperatorRequestPort,
} from './operator-requests'
import type { SessionRecord } from './record/record-adapter'

const REQUESTS_DIRECTORY = 'requests'
const REQUESTS_FILE_MODE = 0o600

export type OperatorInputArgs = {
  requests: OperatorRequestPort
  sessionId: string
  threadId: ThreadId
  sessionDir: string
  calls: RemoteCalls
  record: SessionRecord
  newRunId: () => RunId
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const answerRaced = async (args: {
  answered: Promise<OperatorRequestAnswer>
  abandon: () => void
  signal: AbortSignal
}): Promise<OperatorRequestAnswer> => {
  if (args.signal.aborted) {
    args.abandon()
    return { ok: false, reason: 'cancelled' }
  }
  return await new Promise<OperatorRequestAnswer>((resolve) => {
    const onAbort = (): void => {
      args.abandon()
      resolve({ ok: false, reason: 'cancelled' })
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

  return {
    ask: async ({ ask, signal }) => {
      let opened: OperatorRequestOpen
      try {
        opened = await args.requests.open({
          sessionId: args.sessionId,
          threadId: args.threadId,
          ask,
        })
      } catch (error) {
        return { ok: false, reason: messageOf(error) }
      }

      await append({
        type: OPERATOR_INPUT_ASKED,
        requestId: opened.requestId,
        kind: ask.kind === 'shell' ? EOperatorRequestKind.Shell : EOperatorRequestKind.Input,
        prompt: ask.prompt,
        secret: ask.secret,
        ...(ask.kind === 'shell' ? { shellId: ask.shellId } : {}),
        expiresAt: opened.expiresAt.toISOString(),
        sessionId: args.sessionId,
      })

      const answer = await answerRaced({
        answered: opened.answered,
        abandon: () => opened.abandon('cancelled'),
        signal,
      })
      if (!answer.ok) {
        const outcome =
          answer.reason === 'expired'
            ? EOperatorRequestOutcome.Expired
            : answer.reason === 'cancelled'
              ? EOperatorRequestOutcome.Cancelled
              : EOperatorRequestOutcome.Failed
        await settle({
          requestId: opened.requestId,
          outcome,
          reason: answer.reason,
          sessionId: args.sessionId,
        })
        return { ok: false, reason: answer.reason }
      }

      const delivery =
        ask.kind === 'shell'
          ? await deliverShell({ shellId: ask.shellId, value: answer.value, signal })
          : await deliverFile({ requestId: opened.requestId, value: answer.value, signal })

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
    },
  }
}
