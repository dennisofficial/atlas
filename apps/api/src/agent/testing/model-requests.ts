import { appendFileSync, readFileSync } from 'node:fs'

import type { ModelPort } from '@dltech/atlas-core'

export type RecordedModelRequest = {
  host: string
  sessionId: string
  assembled: { system: readonly { text?: string }[]; messages: readonly { message: unknown }[] }
}

export const recordedRequestsOf = (path: string): RecordedModelRequest[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as RecordedModelRequest)

export const recordingModelOf = (args: {
  inner: ModelPort
  path: string
  host: string
  sessionId: string
}): ModelPort => ({
  identity: args.inner.identity,
  step: (stepArgs) => {
    appendFileSync(
      args.path,
      `${JSON.stringify({
        host: args.host,
        sessionId: args.sessionId,
        assembled: stepArgs.assembled,
      })}\n`,
    )
    return args.inner.step(stepArgs)
  },
})
