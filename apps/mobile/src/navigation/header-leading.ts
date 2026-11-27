import { ESessionsListLayout, type TPosture } from '../layout/posture'

export enum EHeaderLeadingItem {
  Sessions = 'sessions',
}

export const HEADER_BUTTON_SLOT = 52
export const HEADER_EDGE_SLACK = 48
export const HEADER_TITLE_MIN_WIDTH = 120

export const sessionHeaderLeadingOf = ({
  posture,
  drawerOpen,
}: {
  posture: TPosture
  drawerOpen: boolean
}): EHeaderLeadingItem[] =>
  posture.sessionsList === ESessionsListLayout.Panel && drawerOpen
    ? []
    : [EHeaderLeadingItem.Sessions]

export const leadingTitleWidthOf = ({
  barWidth,
  buttons,
}: {
  barWidth: number
  buttons: number
}): number =>
  Math.max(HEADER_TITLE_MIN_WIDTH, barWidth - HEADER_BUTTON_SLOT * buttons - HEADER_EDGE_SLACK)
