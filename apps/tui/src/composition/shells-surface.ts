import { useMemo } from 'react'

import type { ContributedSurface, PluginSurface } from '../plugins/surface'
import { plural } from '@dltech/atlas-client/transcript'
import { chipItem, EFooterItemReach, type FooterItem } from '../ui/footer-item'
import { theme } from '../ui/theme'
import type { ShellsControl } from './use-shells'

export function shellsItem(args: { running: number; onOpen: () => void }): FooterItem | null {
  if (args.running === 0) return null

  return chipItem({
    id: 'shells',
    text: plural(args.running, 'shell'),
    ground: theme.bright,
    ink: theme.appBg,
    reach: EFooterItemReach.Keyboard,
    onActivate: args.onOpen,
  })
}

export const shellsSurface = (args: { shells: ShellsControl }): ContributedSurface => {
  const { running, handleOpen } = args.shells

  return {
    pluginId: 'shells',
    use: (): PluginSurface => {
      const footerItem = useMemo(
        () => shellsItem({ running, onOpen: handleOpen }),
        [handleOpen, running],
      )

      return useMemo(() => ({ footerItem }), [footerItem])
    },
  }
}
