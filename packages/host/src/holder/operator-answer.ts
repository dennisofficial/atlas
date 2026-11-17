import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { ECallFailure, ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'
import {
  EOperatorRequestKind,
  EOperatorRequestOutcome,
  INBOX_KIND_OPERATOR_ANSWER,
  OPERATOR_TOOL_NAMES,
  deliveredTextOf,
  operatorAnswerPayloadSchema,
  operatorRequestSchema,
  refusalTextOf,
  type OperatorAnswerPayload,
  type OperatorRequest,
} from '@dltech/atlas-plugin-operator/core'
import {
  openParkedCallsOf,
  parkedResultDraft,
  type CallId,
  type EventDraft,
  type InboxEntry,
  type JsonValue,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

import type { RemoteCalls } from '../calls/remote-calls'
import type { AppendBody, SessionRecord } from './record/record-adapter'

const REQUESTS_DIRECTORY = 'requests'
const REQUESTS_FILE_MODE = 0o600
const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const CANCELLED_REASON = 'the operator cancelled the request'

export const OPERATOR_ANSWER_KIND = INBOX_KIND_OPERATOR_ANSWER

export type OperatorAnswerOutcome = { wakesTurn: boolean }

export type OperatorAnswerIntake = {
  handle(entry: InboxEntry): Promise<OperatorAnswerOutcome>
  cancelOpen(args: { reason: string }): Promise<void>
}

export type OperatorAnswersArgs = {
  calls: RemoteCalls
  sessionId: string
  threadId: ThreadId
  sessionDir: string
  record: SessionRecord
  newRunId: () => RunId
}

type OpenCall = { callId: CallId; name: string; request: OperatorRequest }

type Delivery =
  | { ok: true; path?: string | undefined; shellId?: string | undefined; bytes: number }
  | { ok: false; reason: string }

const payloadOf = (payload: string): OperatorAnswerPayload | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return undefined
  }
  const answer = operatorAnswerPayloadSchema.safeParse(parsed)
  return answer.success ? answer.data : undefined
}

const fileNameOf = (callId: string): string =>
  CALL_ID_PATTERN.test(callId) ? callId : createHash('sha256').update(callId).digest('hex')

export const operatorAnswersOf = (args: OperatorAnswersArgs): OperatorAnswerIntake => {
  const invoke = (op: CallOp): Promise<CallResult> =>
    args.calls.invoke({ key: `${args.sessionId}:${op.op}`, op })

  const openCalls = () => openParkedCallsOf(args.record.eventCache().visibleLoopEvents())

  const operatorCalls = (): readonly { callId: CallId; name: string }[] =>
    openCalls().filter((open) => OPERATOR_TOOL_NAMES.includes(open.name))

  const openCallOf = (callId: string): OpenCall | undefined => {
    const open = operatorCalls().find((candidate) => candidate.callId === callId)
    if (open === undefined) return undefined
    const parked = openCalls().find((candidate) => candidate.callId === callId)
    const parsed = operatorRequestSchema.safeParse(parked?.request)
    if (!parsed.success) return undefined
    return { callId: open.callId, name: open.name, request: parsed.data }
  }

  const append = async (drafts: readonly AppendBody[]): Promise<void> => {
    if (drafts.length === 0) return
    await args.record.append({ threadId: args.threadId, runId: args.newRunId(), drafts })
  }

  const closingDraft = (
    params: { call: { callId: CallId; name: string }; output: JsonValue } & (
      | { modelText: string }
      | { refusal: string }
    ),
  ): EventDraft =>
    parkedResultDraft({
      callId: params.call.callId,
      name: params.call.name,
      output: params.output,
      ...('modelText' in params
        ? { modelText: params.modelText }
        : { error: { message: refusalTextOf(params.refusal) } }),
    })

  const deliver = async (params: { call: OpenCall; value: string }): Promise<Delivery> => {
    const bytes = Buffer.byteLength(params.value, 'utf8')
    if (params.call.request.kind === EOperatorRequestKind.Shell) {
      const shellId = params.call.request.shellId
      const written = await invoke({ op: 'shells.write', shellId, data: params.value, end: false })
      if (written.status === ECallStatus.Failed)
        return {
          ok: false,
          reason: `the value could not be typed into shell ${shellId}: ${written.error.message}`,
        }
      return { ok: true, shellId, bytes }
    }
    const directory = join(args.sessionDir, REQUESTS_DIRECTORY)
    const path = join(directory, fileNameOf(params.call.callId))
    const made = await invoke({ op: 'mkdir', path: directory })
    if (made.status === ECallStatus.Failed && made.error.code !== ECallFailure.AlreadyExists)
      return {
        ok: false,
        reason: `the requests directory could not be created: ${made.error.message}`,
      }
    const written = await invoke({
      op: 'writeFile',
      path,
      content: params.value,
      mode: REQUESTS_FILE_MODE,
    })
    if (written.status === ECallStatus.Failed)
      return { ok: false, reason: `the value could not be written: ${written.error.message}` }
    return { ok: true, path, bytes }
  }

  const handle = async (entry: InboxEntry): Promise<OperatorAnswerOutcome> => {
    const payload = payloadOf(entry.payload)
    if (payload === undefined) return { wakesTurn: false }
    const call = openCallOf(payload.callId)
    if (call === undefined) return { wakesTurn: false }

    if ('cancel' in payload) {
      await append([
        closingDraft({
          call,
          output: { outcome: EOperatorRequestOutcome.Cancelled, reason: CANCELLED_REASON },
          refusal: CANCELLED_REASON,
        }),
      ])
      return { wakesTurn: true }
    }

    const delivery = await deliver({ call, value: payload.value })
    const output: JsonValue = delivery.ok
      ? {
          outcome: EOperatorRequestOutcome.Delivered,
          ...(delivery.path === undefined ? {} : { path: delivery.path }),
          bytes: delivery.bytes,
        }
      : { outcome: EOperatorRequestOutcome.Failed, reason: delivery.reason }
    const closing = delivery.ok
      ? closingDraft({
          call,
          output,
          modelText: deliveredTextOf({
            kind: call.request.kind,
            path: delivery.path,
            shellId: delivery.shellId,
            bytes: delivery.bytes,
          }),
        })
      : closingDraft({ call, output, refusal: delivery.reason })
    await append([closing])
    return { wakesTurn: true }
  }

  const cancelOpen = async (params: { reason: string }): Promise<void> => {
    const open = operatorCalls()
    if (open.length === 0) return
    await append(
      open.map((call) =>
        closingDraft({
          call,
          output: { outcome: EOperatorRequestOutcome.Cancelled, reason: params.reason },
          refusal: params.reason,
        }),
      ),
    )
  }

  return { handle, cancelOpen }
}
