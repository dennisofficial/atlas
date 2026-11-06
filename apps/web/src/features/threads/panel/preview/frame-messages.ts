import { z } from 'zod'

const LOCATION_KIND = 'atlas-preview:location'
const LOADING_KIND = 'atlas-preview:loading'
const PREVIEW_ORIGIN_PATTERN = /^https:\/\/\d{2,5}-[a-z0-9]{10}\.byatlas\.dev$/

export enum EFrameMessage {
  Location = 'location',
  Loading = 'loading',
}

const frameMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(LOCATION_KIND), url: z.string().min(1), title: z.string() }),
  z.object({ kind: z.literal(LOADING_KIND) }),
])

export type FrameMessage =
  | { kind: EFrameMessage.Location; url: string; title: string }
  | { kind: EFrameMessage.Loading }

export type FrameReport = { key: string; message: FrameMessage }

export function parseFrameMessage(data: unknown): FrameMessage | null {
  const parsed = frameMessageSchema.safeParse(data)
  if (!parsed.success) return null
  if (parsed.data.kind === LOADING_KIND) return { kind: EFrameMessage.Loading }
  return { kind: EFrameMessage.Location, url: parsed.data.url, title: parsed.data.title }
}

export function isPreviewOrigin(origin: string): boolean {
  return PREVIEW_ORIGIN_PATTERN.test(origin)
}

const originOf = (url: string): string | null => (URL.canParse(url) ? new URL(url).origin : null)

export function frameReportOf(args: {
  origin: string
  source: unknown
  data: unknown
  windows: ReadonlyMap<string, unknown>
}): FrameReport | null {
  const { origin, source, data, windows } = args
  if (source === null || !isPreviewOrigin(origin)) return null
  const key = [...windows].find(([, held]) => held === source)?.[0]
  if (key === undefined) return null
  const message = parseFrameMessage(data)
  if (message === null) return null
  if (message.kind === EFrameMessage.Location && originOf(message.url) !== origin) return null
  return { key, message }
}
