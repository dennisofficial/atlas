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
