import { z } from 'zod'

const LOCATION_KIND = 'atlas-preview:location'
const PREVIEW_ORIGIN_PATTERN = /^https:\/\/\d{2,5}-[a-z0-9]{10}\.byatlas\.dev$/

const frameLocationSchema = z.object({
  kind: z.literal(LOCATION_KIND),
  url: z.string().min(1),
  title: z.string(),
})

export type FrameLocation = { url: string; title: string }

export type FrameReport = { key: string; url: string; title: string }

export function parseFrameMessage(data: unknown): FrameLocation | null {
  const parsed = frameLocationSchema.safeParse(data)
  if (!parsed.success) return null
  return { url: parsed.data.url, title: parsed.data.title }
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
  const location = parseFrameMessage(data)
  if (location === null || originOf(location.url) !== origin) return null
  return { key, url: location.url, title: location.title }
}
