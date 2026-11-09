import type { NativeWebview } from './webview-handle'

export type FrameWish = { url: string; seq: number; visible: boolean }

export type FrameDriver = {
  apply: (wish: FrameWish) => void
  setObscured: (obscured: boolean) => void
  reassertVisibility: () => void
}

export function createFrameDriver(args: { webview: NativeWebview; seq: number }): FrameDriver {
  const { webview } = args
  let loadedSeq = args.seq
  let visible = true
  let obscured = false
  let hidden = false

  const syncVisibility = (force = false) => {
    const next = !visible || obscured
    if (!force && next === hidden) return
    webview.toggleHidden(next)
    hidden = next
    // A view shown again after being hidden can keep a blank surface until it is told its geometry anew.
    if (!next) webview.syncDimensions(true)
  }

  return {
    apply: (wish) => {
      visible = wish.visible
      if (wish.seq !== loadedSeq) {
        loadedSeq = wish.seq
        webview.loadURL(wish.url)
      }
      syncVisibility()
    },
    setObscured: (next) => {
      const shown = obscured && !next
      obscured = next
      syncVisibility(shown)
    },
    // toggleHidden is dropped until the native view exists, so a tab hidden before dom-ready needs it again
    // https://github.com/blackboardsh/electrobun/blob/v2.0.5/package/src/preload/webviewTag.ts#L337
    reassertVisibility: () => syncVisibility(true),
  }
}
