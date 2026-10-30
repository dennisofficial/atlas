import { z } from 'zod'

export const desktopVersionSchema = z.object({
  version: z.string(),
  channel: z.string(),
})
export type DesktopVersion = z.infer<typeof desktopVersionSchema>

let cached: Promise<DesktopVersion | null> | null = null

export function desktopVersion(): Promise<DesktopVersion | null> {
  cached ??= fetch('/desktop/version')
    .then(async (response) =>
      response.ok ? desktopVersionSchema.parse(await response.json()) : null,
    )
    .catch(() => null)
  return cached
}

export function resetDesktopVersion(): void {
  cached = null
}
