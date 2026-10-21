import { ESandboxProvisionState, type EThreadMessageState } from '@dltech/atlas-wire/web'

import { postMessage, provisionSandbox } from './threads-api'

export const NOT_CONFIGURED_FALLBACK = 'Atlas Cloud could not start a sandbox for this thread.'

export enum ESendKind {
  Sent = 'sent',
  NotConfigured = 'not-configured',
}

export type SendOutcome =
  | { kind: ESendKind.Sent; state: EThreadMessageState }
  | { kind: ESendKind.NotConfigured; error: string }

export async function sendMessage(args: {
  threadId: string
  projectId?: string | undefined
  text: string
  sendId: string
}): Promise<SendOutcome> {
  const provision = await provisionSandbox({ threadId: args.threadId, projectId: args.projectId })
  if (provision.state === ESandboxProvisionState.NotConfigured) {
    return { kind: ESendKind.NotConfigured, error: provision.error ?? NOT_CONFIGURED_FALLBACK }
  }
  const reply = await postMessage({
    threadId: args.threadId,
    sendId: args.sendId,
    text: args.text,
  })
  return { kind: ESendKind.Sent, state: reply.state }
}
