export const WIDE_MIN_WIDTH = 600

export enum ESessionsListLayout {
  Stacked = 'stacked',
  Overlay = 'overlay',
  Panel = 'panel',
}

export type TInsets = { top: number; right: number; bottom: number; left: number }

export type TPosture = {
  sessionsList: ESessionsListLayout
}

const sessionsListOf = ({ contentWidth, height }: { contentWidth: number; height: number }) => {
  if (contentWidth < WIDE_MIN_WIDTH) return ESessionsListLayout.Stacked
  return contentWidth > height ? ESessionsListLayout.Panel : ESessionsListLayout.Overlay
}

export const postureOf = ({
  width,
  height,
  insets,
}: {
  width: number
  height: number
  insets: TInsets
}): TPosture => ({
  sessionsList: sessionsListOf({ contentWidth: width - insets.left - insets.right, height }),
})
