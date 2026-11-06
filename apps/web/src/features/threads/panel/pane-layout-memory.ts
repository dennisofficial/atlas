import { z } from 'zod'

export const PANE_LAYOUTS_KEY = 'atlas:thread-pane-layouts'
export const MAX_REMEMBERED_LAYOUTS = 200

const paneLayoutSchema = z.record(z.string(), z.number())
const paneLayoutsSchema = z.record(z.string(), paneLayoutSchema)

export type PaneLayout = z.infer<typeof paneLayoutSchema>
type PaneLayouts = z.infer<typeof paneLayoutsSchema>

export function parsePaneLayouts(raw: string | null): PaneLayouts {
  if (raw === null) return {}
  try {
    const parsed = paneLayoutsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

export function withPaneLayout(args: {
  layouts: PaneLayouts
  threadId: string
  layout: PaneLayout
}): PaneLayouts {
  const { [args.threadId]: _replaced, ...rest } = args.layouts
  const entries = [...Object.entries(rest), [args.threadId, args.layout] as const]
  return Object.fromEntries(entries.slice(-MAX_REMEMBERED_LAYOUTS))
}

function readPaneLayouts(): PaneLayouts {
  try {
    return parsePaneLayouts(window.localStorage.getItem(PANE_LAYOUTS_KEY))
  } catch {
    return {}
  }
}

export function recallPaneLayout(threadId: string): PaneLayout | undefined {
  return readPaneLayouts()[threadId]
}

export function rememberPaneLayout(args: { threadId: string; layout: PaneLayout }): void {
  const next = withPaneLayout({ layouts: readPaneLayouts(), ...args })
  try {
    window.localStorage.setItem(PANE_LAYOUTS_KEY, JSON.stringify(next))
  } catch {}
}
