import type {
  ExpoPushMessage,
  ExpoPushReceipt,
  ExpoPushTicket,
} from '../../../_lib/expo-push/expo-push.client'
import { receiptDeadToken, ticketDeadToken } from '../../../_lib/expo-push/expo-push.client'
import type { PushSendOutput, PushSendPayload } from './push-send.contract'

// https://docs.expo.dev/push-notifications/sending-notifications/#check-receipts
export const RECEIPT_DELAY_MS = 15 * 60 * 1000

export type PushSendDeps = {
  send: (messages: ExpoPushMessage[]) => Promise<ExpoPushTicket[]>
  getReceipts: (ticketIds: string[]) => Promise<Record<string, ExpoPushReceipt>>
  wait: (ms: number) => Promise<void>
  pruneTokens: (tokens: string[]) => Promise<void>
  log: (message: string) => void
}

export async function runPushSend(args: {
  payload: PushSendPayload
  deps: PushSendDeps
}): Promise<PushSendOutput> {
  const { payload, deps } = args
  const tickets = await deps.send(payload.messages)
  let pruned = 0

  const okTicketIds: { id: string; token: string }[] = []
  const deadNow: string[] = []
  for (const [index, ticket] of tickets.entries()) {
    const message = payload.messages[index]
    if (message === undefined) continue
    if (ticketDeadToken(ticket)) {
      deadNow.push(message.to)
      continue
    }
    if (ticket.status === 'error') {
      deps.log(`push ticket failed for ${message.to}: ${ticket.message ?? 'unknown error'}`)
      continue
    }
    if (ticket.id !== undefined) okTicketIds.push({ id: ticket.id, token: message.to })
  }
  if (deadNow.length > 0) {
    await deps.pruneTokens(deadNow)
    pruned += deadNow.length
  }
  if (okTicketIds.length === 0) return { sent: okTicketIds.length, pruned }

  await deps.wait(RECEIPT_DELAY_MS)
  let receipts: Record<string, ExpoPushReceipt>
  try {
    receipts = await deps.getReceipts(okTicketIds.map((ticket) => ticket.id))
  } catch (failure) {
    // A retry would re-send the notifications, so a receipts failure is only logged.
    deps.log(
      `fetching push receipts failed: ${failure instanceof Error ? failure.message : String(failure)}`,
    )
    return { sent: okTicketIds.length, pruned }
  }

  const deadLater: string[] = []
  for (const ticket of okTicketIds) {
    const receipt = receipts[ticket.id]
    if (receipt === undefined) continue
    if (receiptDeadToken(receipt)) deadLater.push(ticket.token)
    else if (receipt.status === 'error') {
      deps.log(`push receipt failed for ${ticket.token}: ${receipt.message ?? 'unknown error'}`)
    }
  }
  if (deadLater.length > 0) {
    await deps.pruneTokens(deadLater)
    pruned += deadLater.length
  }
  return { sent: okTicketIds.length, pruned }
}
