import { z } from 'zod'

const desktopBridgeSchema = z.object({ vibrancy: z.boolean().optional() })

export function applyDesktopAttributes({ root, host }: { root: HTMLElement; host: object }): void {
  const parsed = desktopBridgeSchema.safeParse(Reflect.get(host, 'atlasDesktop'))
  if (!parsed.success) return
  root.dataset.desktop = ''
  if (parsed.data.vibrancy === true) root.dataset.vibrancy = ''
}
