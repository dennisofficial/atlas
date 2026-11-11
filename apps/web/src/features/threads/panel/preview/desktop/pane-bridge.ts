import { z } from 'zod'

const paneNavigationSchema = z.object({ id: z.string().min(1), url: z.string().min(1) })
const paneTitleSchema = z.object({ id: z.string().min(1), title: z.string() })

export type PaneNavigation = z.infer<typeof paneNavigationSchema>
export type PaneTitle = z.infer<typeof paneTitleSchema>

type BridgeListener = (report: unknown) => void
type BridgeCall = (listener: BridgeListener) => void

const bridgeOf = (host: object): object | null => {
  const bridge: unknown = Reflect.get(host, 'atlasDesktop')
  return typeof bridge === 'object' && bridge !== null ? bridge : null
}

const callOf = (bridge: object | null, name: string): BridgeCall | null => {
  if (bridge === null) return null
  const value = Reflect.get(bridge, name)
  return typeof value === 'function' ? (value as BridgeCall) : null
}

const parsedInto = <T>(schema: z.ZodType<T>) => {
  const parse = (raw: unknown): T | null => {
    const result = schema.safeParse(raw)
    return result.success ? result.data : null
  }
  return parse
}

function watch<T>(args: {
  host: object
  on: string
  off: string
  parse: (raw: unknown) => T | null
  onReport: (report: T) => void
}): () => void {
  const bridge = bridgeOf(args.host)
  const on = callOf(bridge, args.on)
  const off = callOf(bridge, args.off)
  if (bridge === null || on === null) return () => undefined
  const listener: BridgeListener = (raw) => {
    const report = args.parse(raw)
    if (report !== null) args.onReport(report)
  }
  on.call(bridge, listener)
  return () => {
    off?.call(bridge, listener)
  }
}

export const watchPaneNavigations = (args: {
  host: object
  onReport: (report: PaneNavigation) => void
}): (() => void) =>
  watch({
    ...args,
    on: 'onPaneNavigated',
    off: 'offPaneNavigated',
    parse: parsedInto(paneNavigationSchema),
  })

export const watchPaneTitles = (args: {
  host: object
  onReport: (report: PaneTitle) => void
}): (() => void) =>
  watch({ ...args, on: 'onPaneTitled', off: 'offPaneTitled', parse: parsedInto(paneTitleSchema) })
