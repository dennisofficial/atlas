export const RAIL_MIN_INSET = 44
export const WIDE_MIN_WIDTH = 600
export const RAIL_TOP_CLEARANCE = 160
export const BOTTOM_BAR_CLEARANCE = 96

export enum EControlsPlacement {
  Rail = 'rail',
  BottomBar = 'bottom-bar',
}

export enum EThreadsLayout {
  Stacked = 'stacked',
  Overlay = 'overlay',
  Panel = 'panel',
}

export type TInsets = { top: number; right: number; bottom: number; left: number }

export type TPosture = {
  controls: EControlsPlacement
  threads: EThreadsLayout
  railWidth: number
  clearance: { right: number; bottom: number }
}

const controlsOf = (insets: TInsets): EControlsPlacement =>
  insets.right >= RAIL_MIN_INSET && insets.right > insets.left
    ? EControlsPlacement.Rail
    : EControlsPlacement.BottomBar

const threadsOf = ({ contentWidth, height }: { contentWidth: number; height: number }) => {
  if (contentWidth < WIDE_MIN_WIDTH) return EThreadsLayout.Stacked
  return contentWidth > height ? EThreadsLayout.Panel : EThreadsLayout.Overlay
}

export const postureOf = ({
  width,
  height,
  insets,
}: {
  width: number
  height: number
  insets: TInsets
}): TPosture => {
  const controls = controlsOf(insets)
  return {
    controls,
    threads: threadsOf({ contentWidth: width - insets.left - insets.right, height }),
    railWidth: controls === EControlsPlacement.Rail ? insets.right : 0,
    clearance: {
      right: insets.right,
      bottom:
        controls === EControlsPlacement.BottomBar
          ? insets.bottom + BOTTOM_BAR_CLEARANCE
          : insets.bottom,
    },
  }
}
