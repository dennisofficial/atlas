import {
  EModelFallbackReason,
  INBOX_KIND_EVENT,
  inboxEventPayloadOf,
  refKey,
  type EventBody,
  type ModelChoice,
} from '@dltech/atlas-core'
import type { SessionModelAsk } from '@dltech/atlas-models'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { modelLabelOf } from '../config/model-labels'
import { EFastRefusal, type FastRefusal } from '../model/providers/fast-fallback'

export type FastRefusalSessions = {
  readSession(args: { sessionId: string }): Promise<{ modelFast: boolean } | undefined>
  setSessionModel(args: { sessionId: string; ask: SessionModelAsk }): Promise<unknown>
  post(args: { sessionId: string; kind: string; payload: string }): Promise<{ inboxId: number }>
}

const MAIN_ROLE = 'main'

const noticeOf = (args: { choice: ModelChoice }): EventBody => {
  const label = modelLabelOf(args.choice.ref)
  return {
    type: 'model-fell-back',
    role: MAIN_ROLE,
    from: { ref: refKey(args.choice.ref), label },
    to: { ref: refKey(args.choice.ref), label },
    reason: EModelFallbackReason.FastCreditsRequired,
  }
}

const logRateLimited = (args: { refusal: FastRefusal; log: LogPort | undefined }): void => {
  args.log?.warn({
    source: 'model.fast-refused',
    message:
      'the provider refused a fast request without naming credits; ran this call at standard speed',
    data: {
      kind: args.refusal.kind,
      ...(args.refusal.status === undefined ? {} : { status: args.refusal.status }),
      detail: args.refusal.message,
    },
  })
}

export const fastRefusalHandler = (args: {
  sessions: FastRefusalSessions
  sessionId: string
  choice: () => ModelChoice
  log?: LogPort | undefined
}): ((refusal: FastRefusal) => Promise<void>) => {
  const turnFastOff = async (): Promise<void> => {
    const session = await args.sessions.readSession({ sessionId: args.sessionId })
    if (session === undefined || !session.modelFast) return
    const choice = args.choice()
    await args.sessions.setSessionModel({
      sessionId: args.sessionId,
      ask: { ref: refKey(choice.ref), effort: choice.effort, fast: false },
    })
    await args.sessions.post({
      sessionId: args.sessionId,
      kind: INBOX_KIND_EVENT,
      payload: inboxEventPayloadOf({
        event: noticeOf({ choice }),
        clientId: `fast-credits:${args.sessionId}`,
      }),
    })
    args.log?.warn({
      source: 'model.fast-refused',
      message: 'the provider needs usage credits for fast mode; turned fast mode off',
      data: { model: refKey(choice.ref) },
    })
  }

  return async (refusal) => {
    if (refusal.kind === EFastRefusal.RateLimited) {
      logRateLimited({ refusal, log: args.log })
      return
    }
    try {
      await turnFastOff()
    } catch (error) {
      args.log?.error({
        source: 'model.fast-refused',
        message: 'turning fast mode off after a credits refusal failed',
        ...logFieldsOf({ error }),
      })
    }
  }
}
