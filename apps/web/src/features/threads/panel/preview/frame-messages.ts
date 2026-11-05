import { z } from 'zod'

export enum EFrameCommand {
  Back = 'back',
  Forward = 'forward',
  Reload = 'reload',
}

const LOCATION_KIND = 'atlas-preview:location'
const COMMAND_KIND = 'atlas-preview:command'
const PREVIEW_ORIGIN_PATTERN = /^https:\/\/\d{2,5}-[a-z0-9]{10}\.byatlas\.dev$/

const frameLocationSchema = z.object({
  kind: z.literal(LOCATION_KIND),
  url: z.string().min(1),
  title: z.string(),
})

export type FrameLocation = { url: string; title: string }

export type FrameCommandMessage = { kind: typeof COMMAND_KIND; command: EFrameCommand }

export function parseFrameMessage(data: unknown): FrameLocation | null {
  const parsed = frameLocationSchema.safeParse(data)
  if (!parsed.success) return null
  return { url: parsed.data.url, title: parsed.data.title }
}

export function frameCommandOf(command: EFrameCommand): FrameCommandMessage {
  return { kind: COMMAND_KIND, command }
}

export function isPreviewOrigin(origin: string): boolean {
  return PREVIEW_ORIGIN_PATTERN.test(origin)
}
