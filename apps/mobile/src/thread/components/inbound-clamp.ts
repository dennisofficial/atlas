export const COLLAPSED_BODY_HEIGHT = 240

export type InboundClamp = {
  overflows: boolean
  clamped: boolean
}

export const inboundClampOf = ({
  contentHeight,
  expanded,
}: {
  contentHeight: number
  expanded: boolean
}): InboundClamp => {
  const overflows = contentHeight > COLLAPSED_BODY_HEIGHT
  return { overflows, clamped: overflows && !expanded }
}

export const contentHeightAfter = ({
  previous,
  measured,
  clamped,
}: {
  previous: number
  measured: number
  clamped: boolean
}): number => (clamped ? previous : measured)
