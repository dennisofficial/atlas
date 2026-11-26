import type { ESessionsListLayout } from './posture'

export type TOverlayScope = { layout: ESessionsListLayout; screen: string | null }

export type TScopedOverlay = { open: boolean; scope: TOverlayScope }

export const closedOverlayOf = (scope: TOverlayScope): TScopedOverlay => ({ open: false, scope })

const sameScope = ({ a, b }: { a: TOverlayScope; b: TOverlayScope }): boolean =>
  a.layout === b.layout && a.screen === b.screen

export const scopedOverlayOf = ({
  overlay,
  scope,
}: {
  overlay: TScopedOverlay
  scope: TOverlayScope
}): TScopedOverlay => (sameScope({ a: overlay.scope, b: scope }) ? overlay : closedOverlayOf(scope))
