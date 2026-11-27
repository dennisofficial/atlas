export const WIDE_MIN_WIDTH = 600

export enum ESessionsListLayout {
  Stacked = 'stacked',
  Overlay = 'overlay',
  Panel = 'panel',
}

export type TInsets = { top: number; right: number; bottom: number; left: number }

export const SIDE_COLUMN_MIN_INSET = 44

export const sideColumnInsetOf = (insets: TInsets): number =>
  insets.right >= SIDE_COLUMN_MIN_INSET && insets.right > insets.left ? insets.right : 0

export const contentWidthOf = ({
  windowWidth,
  insets,
}: {
  windowWidth: number
  insets: TInsets
}): number => windowWidth - sideColumnInsetOf(insets)

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
