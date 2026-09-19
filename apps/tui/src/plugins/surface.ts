import type { PluginSurfaceHook as GenericPluginSurfaceHook } from '@dltech/atlas-harness'

import type { FooterItem } from '../ui/footer-item'
import type { SidebarSection } from '../ui/sidebar-section'

export type { SidebarSection, SidebarSectionRow } from '../ui/sidebar-section'
export { ESidebarPlace } from '../ui/sidebar-section'

export type PluginSurface = {
  footerItem?: FooterItem | null
  sidebarSection?: SidebarSection | null
}

export type PluginSurfaceHook = GenericPluginSurfaceHook<PluginSurface>

export const SURFACES_NOTHING: PluginSurface = Object.freeze({})

export type ContributedSurface = {
  pluginId: string
  use: PluginSurfaceHook
}
