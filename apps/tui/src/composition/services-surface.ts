import { useMemo } from 'react'

import type { ContributedSurface, PluginSurface } from '../plugins/surface'
import { plural } from '@dltech/atlas-client/transcript'
import { chipItem, EFooterItemReach, type FooterItem } from '../ui/footer-item'
import { SERVICE_BLUE, theme } from '../ui/theme'
import type { ServicesControl } from './use-services'

export function servicesChipText(args: {
  running: number
  declaredRunning: number
  declaredTotal: number
}): string | null {
  if (args.declaredTotal > 0) return `${args.declaredRunning}/${args.declaredTotal} services`
  return args.running === 0 ? null : plural(args.running, 'service')
}

export function servicesItem(args: {
  running: number
  declaredRunning?: number
  declaredTotal?: number
  attention?: boolean
  onOpen: () => void
}): FooterItem | null {
  const text = servicesChipText({
    running: args.running,
    declaredRunning: args.declaredRunning ?? 0,
    declaredTotal: args.declaredTotal ?? 0,
  })
  if (text === null) return null

  return chipItem({
    id: 'services',
    text,
    ground: args.attention === true ? theme.warn : SERVICE_BLUE,
    ink: theme.appBg,
    reach: EFooterItemReach.Keyboard,
    onActivate: args.onOpen,
  })
}

export const servicesSurface = (args: { services: ServicesControl }): ContributedSurface => {
  const { running, handleOpen, declaredRunning, declaredTotal, attention } = args.services

  return {
    pluginId: 'services',
    use: (): PluginSurface => {
      const footerItem = useMemo(
        () =>
          servicesItem({ running, declaredRunning, declaredTotal, attention, onOpen: handleOpen }),
        [attention, declaredRunning, declaredTotal, handleOpen, running],
      )

      return useMemo(() => ({ footerItem }), [footerItem])
    },
  }
}
