export interface IFullscreenWindow {
  isFullScreen: () => boolean
  on: (name: 'resize', handler: (event: unknown) => void) => void
  webview: {
    executeJavascript: (js: string) => void
    on: (name: 'dom-ready', handler: (event: unknown) => void) => void
  }
}

export function fullscreenScript(fullscreen: boolean): string {
  return `document.documentElement.toggleAttribute('data-fullscreen', ${fullscreen})`
}

export function syncFullscreen({ win }: { win: IFullscreenWindow }): void {
  let last: boolean | null = null
  const push = () => {
    const current = win.isFullScreen()
    if (current === last) return
    last = current
    win.webview.executeJavascript(fullscreenScript(current))
  }
  win.on('resize', push)
  win.webview.on('dom-ready', () => {
    last = null
    push()
  })
}
