import type { RunId, ThreadId } from '@dltech/atlas-core'
import {
  EOperatorRequestKind,
  OPERATOR_INPUT_ASKED,
  type OperatorInputAsked,
} from '@dltech/atlas-plugin-operator/core'
import type { PodOperatorInput } from '@dltech/atlas-plugin-sdk'

import type { OperatorRequestPort } from './operator-requests'
import type { SessionRecord } from './record/record-adapter'

export type OperatorInputArgs = {
  requests: OperatorRequestPort
  sessionId: string
  threadId: ThreadId
  record: SessionRecord
  newRunId: () => RunId
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const operatorInputOf = (args: OperatorInputArgs): PodOperatorInput => ({
  ask: async (askArgs) => {
    let requestId: string
    try {
      const opened = await args.requests.open({
        sessionId: args.sessionId,
        threadId: args.threadId,
        ask: askArgs.ask,
      })
      requestId = opened.requestId
    } catch (error) {
      return { ok: false, reason: messageOf(error) }
    }

    const asked: OperatorInputAsked = {
      type: OPERATOR_INPUT_ASKED,
      requestId,
      kind: askArgs.ask.kind === 'shell' ? EOperatorRequestKind.Shell : EOperatorRequestKind.Input,
      prompt: askArgs.ask.prompt,
      secret: askArgs.ask.secret,
      ...(askArgs.ask.kind === 'shell' ? { shellId: askArgs.ask.shellId } : {}),
      sessionId: args.sessionId,
    }
    await args.record.append({
      threadId: args.threadId,
      runId: args.newRunId(),
      drafts: [asked],
    })
    return { ok: true, requestId }
  },
})
