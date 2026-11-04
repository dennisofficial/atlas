import type { HingeStatus } from 'expo-hinge'

export const PANE_MIN_WIDTH = 320
export const PANEL_WIDTH = 380
export const SPLIT_MIN_WIDTH = PANE_MIN_WIDTH * 2

export enum EPaneLayout {
  Single = 'single',
  Split = 'split',
}

export type PaneLayout =
  | { kind: EPaneLayout.Single }
  | {
      kind: EPaneLayout.Split
      primaryWidth: number
      secondaryWidth: number
      alignedToFold: boolean
    }

const OPEN_STATUSES: ReadonlySet<HingeStatus> = new Set(['partiallyOpen', 'fullyOpen'])

export const isFoldOpen = (status: HingeStatus | null): boolean =>
  status !== null && OPEN_STATUSES.has(status)

export const paneLayoutOf = ({
  width,
  hingeStatus,
}: {
  width: number
  hingeStatus: HingeStatus | null
}): PaneLayout => {
  if (width < SPLIT_MIN_WIDTH) return { kind: EPaneLayout.Single }
  if (isFoldOpen(hingeStatus)) {
    const primaryWidth = Math.floor(width / 2)
    return {
      kind: EPaneLayout.Split,
      primaryWidth,
      secondaryWidth: width - primaryWidth,
      alignedToFold: true,
    }
  }
  const secondaryWidth = Math.min(PANEL_WIDTH, width - PANE_MIN_WIDTH)
  return {
    kind: EPaneLayout.Split,
    primaryWidth: width - secondaryWidth,
    secondaryWidth,
    alignedToFold: false,
  }
}
