import { EClientRequest, EServeFrame, restoreTranscriptParamsSchema, type RestoreTranscriptParams } from '@dltech/atlas-harness'

import { answeredRequest, refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'
import type { ServeTurnDriver } from './turn-driver'

export type RestoreOutcome = { restored: boolean; failed: string | null }

export const isRestoreOp = (op: EClientRequest): boolean => op === EClientRequest.RestoreTranscript

export function createRestoreRequests(args: {
  driver: Pick<ServeTurnDriver, 'busy'>
  restoreTranscript: ((marker?: RestoreTranscriptParams['locationChanged']) => Promise<RestoreOutcome>) | undefined
}) {
  const state: { restoring: Promise<RestoreOutcome> | null } = { restoring: null }
  const answer = (routed: { frame: RequestFrame; reply: (frame: ReplyFrame) => void }): void => {
    const { frame, reply } = routed
    const { restoreTranscript } = args
    if (restoreTranscript === undefined) {
      reply(refusedRequest({ replyTo: frame.id, message: 'this serve cannot restore a transcript' }))
      return
    }
    if (args.driver.busy()) {
      reply(refusedRequest({ replyTo: frame.id, message: 'a turn is running, so the transcript cannot be replaced' }))
      return
    }
    const parsed = restoreTranscriptParamsSchema.safeParse(frame.params ?? {})
    const marker = parsed.success ? parsed.data.locationChanged : undefined
    state.restoring ??= restoreTranscript(marker).finally(() => {
      state.restoring = null
    })
    void state.restoring
      .then((result) =>
        reply(
          result.failed === null
            ? answeredRequest({ replyTo: frame.id, data: { restored: result.restored } })
            : refusedRequest({ replyTo: frame.id, message: result.failed }),
        ),
      )
      .catch((error: unknown) =>
        reply({
          kind: EServeFrame.Reply,
          replyTo: frame.id,
          ok: false,
          data: { message: error instanceof Error ? error.message : 'the transcript restore failed' },
        }),
      )
  }
  return { state, answer }
}
