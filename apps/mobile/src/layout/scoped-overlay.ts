import type { ESessionsListLayout } from './posture'

export type TOverlayScope = { layout: ESessionsListLayout; screen: string | null }

export type TScopedOverlay = { open: boolean; scope: TOverlayScope }

export const defaultOverlayOf = ({
  scope,
  openByDefault,
}: {
  scope: TOverlayScope
  openByDefault: boolean
}): TScopedOverlay => ({ open: openByDefault, scope })

const sameScope = ({ a, b }: { a: TOverlayScope; b: TOverlayScope }): boolean =>
  a.layout === b.layout && a.screen === b.screen

export const scopedOverlayOf = ({
  overlay,
  scope,
  openByDefault,
}: {
  overlay: TScopedOverlay
  scope: TOverlayScope
  openByDefault: boolean
}): TScopedOverlay =>
  sameScope({ a: overlay.scope, b: scope }) ? overlay : defaultOverlayOf({ scope, openByDefault })
