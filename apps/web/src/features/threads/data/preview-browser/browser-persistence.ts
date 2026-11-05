import { z } from 'zod'

import {
  EViewportKind,
  MAX_HISTORY,
  NEW_TAB_URL,
  freshBrowser,
  type BrowserState,
  type BrowserTab,
} from './browser-model'

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
    load: z.object({ url: z.string(), seq: z.number().int().min(0) }).optional(),
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

const restoredTab = (tab: z.output<typeof tabSchema>): BrowserTab => ({
  ...tab,
  load: { url: tab.history[tab.index] ?? NEW_TAB_URL, seq: tab.load?.seq ?? 0 },
})

export function parseBrowserState(args: { raw: string | null; now: number }): BrowserState {
  const { raw, now } = args
  if (raw === null) return freshBrowser({ now })
  try {
    const parsed = stateSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return freshBrowser({ now })
    const { tabs, activeId, nextId } = parsed.data
    return { tabs: tabs.map(restoredTab), activeId, nextId }
  } catch {
    return freshBrowser({ now })
  }
}

export const serializeBrowserState = (state: BrowserState): string => JSON.stringify(state)
