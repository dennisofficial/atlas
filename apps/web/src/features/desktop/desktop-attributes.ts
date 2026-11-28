import { z } from 'zod'

const desktopBridgeSchema = z.object({
  vibrancy: z.boolean().optional(),
  nativeBrowser: z.boolean().optional(),
})

const parseBridge = (host: object) =>
  desktopBridgeSchema.safeParse(Reflect.get(host, 'atlasDesktop'))

export function isDesktopHost(host: object): boolean {
  return parseBridge(host).success
}

export function hasNativeBrowser(host: object): boolean {
  const parsed = parseBridge(host)
  return parsed.success && parsed.data.nativeBrowser === true
}

export function applyDesktopAttributes({ root, host }: { root: HTMLElement; host: object }): void {
  const parsed = parseBridge(host)
  if (!parsed.success) return
  root.dataset.desktop = ''
  if (parsed.data.vibrancy === true) root.dataset.vibrancy = ''
  if (parsed.data.nativeBrowser === true) root.dataset.nativeBrowser = ''
}

export function applyFullScreen({
  root,
  fullScreen,
}: {
  root: HTMLElement
  fullScreen: boolean
}): void {
  root.toggleAttribute('data-fullscreen', fullScreen)
}

export function watchFullScreen({
  host,
  onChange,
}: {
  host: object
  onChange: (fullScreen: boolean) => void
}): () => void {
  const bridge: unknown = Reflect.get(host, 'atlasDesktop')
  if (typeof bridge !== 'object' || bridge === null) return () => undefined
  const read = Reflect.get(bridge, 'fullScreen')
  const watch = Reflect.get(bridge, 'onFullScreenChange')
  const unwatch = Reflect.get(bridge, 'offFullScreenChange')
  if (typeof watch !== 'function' || typeof unwatch !== 'function') return () => undefined
  watch.call(bridge, onChange)
  if (typeof read === 'function') onChange(read.call(bridge) === true)
  return () => {
    unwatch.call(bridge, onChange)
  }
}
