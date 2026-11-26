import { EControlsPlacement, ESessionsListLayout, type TPosture } from '../layout/posture'

export enum EHeaderLeadingItem {
  Account = 'account',
  Sessions = 'sessions',
}

export const HEADER_BUTTON_SLOT = 52
export const HEADER_EDGE_SLACK = 32
export const HEADER_TITLE_MIN_WIDTH = 120

export const tabHeaderLeadingOf = ({ posture }: { posture: TPosture }): EHeaderLeadingItem[] =>
  posture.controls === EControlsPlacement.BottomBar ? [EHeaderLeadingItem.Account] : []

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
