import { z } from 'zod'

export const MAC_LINK_PATH = '/mac-link'

export const MAC_LINK_PROTOCOL_VERSION = 1

export const macLinkPresenceKey = (userId: string): string => `atlas:mac-link:presence:${userId}`

export const macLinkChannel = (userId: string): string => `atlas:mac-link:frames:${userId}`

export const MAC_LINK_PRESENCE_TTL_SECONDS = 60

export const macServerTransportSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.strictObject({
    kind: z.literal('http'),
    url: z.url({ protocol: /^https?$/ }),
    headers: z.record(z.string(), z.string()).optional(),
  }),
])

export type MacServerTransport = z.infer<typeof macServerTransportSchema>

export const jsonRpcMessageSchema = z.looseObject({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
})

export type JsonRpcMessage = z.infer<typeof jsonRpcMessageSchema>

const helloFrame = z.strictObject({
  type: z.literal('hello'),
  v: z.number().int().min(1),
  token: z.string().min(1),
  deviceId: z.string().min(1),
  appVersion: z.string().min(1),
})

const openedFrame = z.strictObject({
  type: z.literal('opened'),
  channelId: z.string().min(1),
})

const openFailedFrame = z.strictObject({
  type: z.literal('open-failed'),
  channelId: z.string().min(1),
  reason: z.string().min(1),
})

const closedFrame = z.strictObject({
  type: z.literal('closed'),
  channelId: z.string().min(1),
  reason: z.string().min(1),
})

const pongFrame = z.strictObject({ type: z.literal('pong') })

const readyFrame = z.strictObject({
  type: z.literal('ready'),
  deviceId: z.string().min(1),
})

const openFrame = z.strictObject({
  type: z.literal('open'),
  channelId: z.string().min(1),
  server: z.strictObject({ name: z.string().min(1), transport: macServerTransportSchema }),
})

const rpcFrame = z.strictObject({
  type: z.literal('rpc'),
  channelId: z.string().min(1),
  message: jsonRpcMessageSchema,
})

const closeFrame = z.strictObject({ type: z.literal('close'), channelId: z.string().min(1) })

const pingFrame = z.strictObject({ type: z.literal('ping') })

export const macClientFrameSchema = z.discriminatedUnion('type', [
  helloFrame,
  openedFrame,
  openFailedFrame,
  rpcFrame,
  closedFrame,
  pongFrame,
])

export const macHostFrameSchema = z.discriminatedUnion('type', [
  readyFrame,
  openFrame,
  rpcFrame,
  closeFrame,
  pingFrame,
])

export const macRelayFrameSchema = z.strictObject({
  origin: z.string().min(1),
  target: z.string().min(1),
  frame: z.discriminatedUnion('type', [
    openFrame,
    rpcFrame,
    closeFrame,
    openedFrame,
    openFailedFrame,
    closedFrame,
    pongFrame,
  ]),
})

export type MacClientFrame = z.infer<typeof macClientFrameSchema>

export type MacHostFrame = z.infer<typeof macHostFrameSchema>

export type MacRelayFrame = z.infer<typeof macRelayFrameSchema>
