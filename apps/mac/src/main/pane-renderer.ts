export type PaneRenderer = 'cef' | 'native'

export const PANE_RENDERER_ENV = 'ATLAS_PANE_RENDERER'

// The pane runs on Apple's own web view unless the app is asked for Chromium, because a CEF view created while the window is not updating never gets a browser at all.
export function paneRendererOf(args: {
  available: string[]
  requested: string | undefined
}): PaneRenderer {
  return args.requested === 'cef' && args.available.includes('cef') ? 'cef' : 'native'
}
