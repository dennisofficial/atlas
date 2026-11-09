import { z } from 'zod'

const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push'
const SEND_LIMIT = 100
const RECEIPT_LIMIT = 1000

const ticketSchema = z.strictObject({
  status: z.enum(['ok', 'error']),
  id: z.string().optional(),
  message: z.string().optional(),
  details: z
    .object({
      error: z.string().optional(),
    })
    .optional(),
})

const sendReplySchema = z.object({ data: z.array(ticketSchema) })

const receiptSchema = z.strictObject({
  status: z.enum(['ok', 'error']),
  message: z.string().optional(),
  details: z
    .object({
      error: z.string().optional(),
    })
    .optional(),
})

const receiptsReplySchema = z.object({ data: z.record(z.string(), receiptSchema) })

export type ExpoPushTicket = z.infer<typeof ticketSchema>
export type ExpoPushReceipt = z.infer<typeof receiptSchema>

export type ExpoPushMessage = {
  to: string
  title?: string | undefined
  body?: string | undefined
  data?: Record<string, string> | undefined
  collapseId?: string | undefined
  threadId?: string | undefined
  contentAvailable?: true | undefined
  priority?: 'default' | 'normal' | 'high' | undefined
}

export interface ExpoPush {
  send: (messages: ExpoPushMessage[]) => Promise<ExpoPushTicket[]>
  getReceipts: (ticketIds: string[]) => Promise<Record<string, ExpoPushReceipt>>
}

const isDeviceNotRegistered = (details: { error?: string | undefined } | undefined): boolean =>
  details?.error === 'DeviceNotRegistered'

export const ticketDeadToken = (ticket: ExpoPushTicket): boolean =>
  ticket.status === 'error' && isDeviceNotRegistered(ticket.details)

export const receiptDeadToken = (receipt: ExpoPushReceipt): boolean =>
  receipt.status === 'error' && isDeviceNotRegistered(receipt.details)

const chunked = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += size)
    chunks.push(items.slice(start, start + size))
  return chunks
}

async function postJson(args: {
  path: string
  accessToken: string | undefined
  body: unknown
}): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  }
  if (args.accessToken !== undefined) headers.authorization = `Bearer ${args.accessToken}`
  const reply = await fetch(`${EXPO_PUSH_API}${args.path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args.body),
  })
  // A failed status means nothing was delivered, so throwing is retry-safe
  // (https://docs.expo.dev/push-notifications/sending-notifications/#http2-api).
  if (!reply.ok) {
    throw new Error(`expo push ${args.path} answered ${reply.status}`)
  }
  return reply
}

export function createExpoPushClient(args: { accessToken?: string | undefined }): ExpoPush {
  const accessToken = args.accessToken
  return {
    async send(messages) {
      const tickets: ExpoPushTicket[] = []
      for (const batch of chunked(messages, SEND_LIMIT)) {
        const reply = await postJson({ path: '/send', accessToken, body: batch })
        const parsed = sendReplySchema.safeParse(await reply.json())
        if (!parsed.success) throw new Error('expo push send answered an unexpected shape')
        tickets.push(...parsed.data.data)
      }
      return tickets
    },
    async getReceipts(ticketIds) {
      const receipts: Record<string, ExpoPushReceipt> = {}
      for (const batch of chunked(ticketIds, RECEIPT_LIMIT)) {
        const reply = await postJson({ path: '/getReceipts', accessToken, body: { ids: batch } })
        const parsed = receiptsReplySchema.safeParse(await reply.json())
        if (!parsed.success) throw new Error('expo push getReceipts answered an unexpected shape')
        Object.assign(receipts, parsed.data.data)
      }
      return receipts
    },
  }
}
