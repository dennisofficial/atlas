import { execFile } from 'node:child_process'

export enum ETitlebarAction {
  Zoom = 'zoom',
  Minimize = 'minimize',
  None = 'none',
}

export interface ITitlebarWindow {
  isMaximized: () => boolean
  maximize: () => void
  unmaximize: () => void
  minimize: () => void
}

export function parseDoubleClickAction(raw: string | null): ETitlebarAction {
  const value = raw?.trim().toLowerCase()
  if (value === 'minimize') return ETitlebarAction.Minimize
  if (value === 'none') return ETitlebarAction.None
  return ETitlebarAction.Zoom
}

export function runTitlebarAction({
  win,
  action,
}: {
  win: ITitlebarWindow
  action: ETitlebarAction
}): void {
  if (action === ETitlebarAction.Minimize) return win.minimize()
  if (action === ETitlebarAction.None) return
  if (win.isMaximized()) return win.unmaximize()
  win.maximize()
}

export function readDoubleClickAction(): Promise<ETitlebarAction> {
  return new Promise((resolve) => {
    execFile('defaults', ['read', '-g', 'AppleActionOnDoubleClick'], (error, stdout) => {
      resolve(parseDoubleClickAction(error ? null : stdout))
    })
  })
}
