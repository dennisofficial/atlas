import { EThreadsLayout, type TPosture } from '../layout/posture'

export enum ESessionHeaderItem {
  Threads = 'threads',
}

export const HEADER_BUTTON_SLOT = 52
export const HEADER_EDGE_SLACK = 32
export const HEADER_TITLE_MIN_WIDTH = 120

export const sessionHeaderItemsOf = ({ posture }: { posture: TPosture }): ESessionHeaderItem[] =>
  posture.threads === EThreadsLayout.Overlay ? [ESessionHeaderItem.Threads] : []

export const leadingTitleWidthOf = ({
  windowWidth,
  posture,
  buttons,
}: {
  windowWidth: number
  posture: TPosture
  buttons: number
}): number =>
  Math.max(
    HEADER_TITLE_MIN_WIDTH,
    windowWidth - posture.railWidth - HEADER_BUTTON_SLOT * buttons - HEADER_EDGE_SLACK,
  )
