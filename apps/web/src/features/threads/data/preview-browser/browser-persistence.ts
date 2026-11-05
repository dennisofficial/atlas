import { z } from 'zod'

import { EViewportKind, MAX_HISTORY, freshBrowser, type BrowserState } from './browser-model'

export const BROWSER_STORAGE_PREFIX = 'atlas.preview-browser.v1.'

export const storageKeyOf = (threadId: string): string => `${BROWSER_STORAGE_PREFIX}${threadId}`

const viewportSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(EViewportKind.Full) }),
  z.object({
    kind: z.literal(EViewportKind.Fixed),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
])

const tabSchema = z
  .object({
    id: z.string().min(1),
    history: z.array(z.string()).min(1).max(MAX_HISTORY),
    index: z.number().int().min(0),
    viewport: viewportSchema,
    lastUsedAt: z.number(),
  })
  .refine((tab) => tab.index < tab.history.length)

const stateSchema = z
  .object({
    tabs: z.array(tabSchema),
    activeId: z.string().optional(),
    nextId: z.number().int().min(1),
  })
  .refine((state) => new Set(state.tabs.map((tab) => tab.id)).size === state.tabs.length)
  .refine(
    (state) => state.activeId === undefined || state.tabs.some((tab) => tab.id === state.activeId),
  )

export function parseBrowserState(args: { raw: string | null; now: number }): BrowserState {
  const { raw, now } = args
  if (raw === null) return freshBrowser({ now })
  try {
    const parsed = stateSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return freshBrowser({ now })
    const { tabs, activeId, nextId } = parsed.data
    return { tabs, activeId, nextId }
  } catch {
    return freshBrowser({ now })
  }
}

export const serializeBrowserState = (state: BrowserState): string => JSON.stringify(state)
