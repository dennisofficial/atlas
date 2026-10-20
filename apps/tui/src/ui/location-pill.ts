import { ERunner } from '@dltech/atlas-core'

import { chipItem, EFooterItemReach, type FooterItem } from './footer-item'
import { theme } from './theme'

export const PLACEMENT_CHIP_ID = 'placement-chip'

export type PlacementChoice = {
  runner?: ERunner | undefined
  provisioning: boolean
  onFlip?: (() => void) | undefined
}

const placementLabelOf = (choice: PlacementChoice): string =>
  choice.runner === ERunner.Local ? ' pod' : ' ☁ cloud'

const placementGroundOf = (choice: PlacementChoice): string => (choice.provisioning ? theme.warn : theme.link)

function placementChipOf(choice: PlacementChoice): FooterItem {
  const flippable = !choice.provisioning && choice.onFlip !== undefined
  return chipItem({
    id: PLACEMENT_CHIP_ID,
    text: `${placementLabelOf(choice)}${flippable ? ' ▾ ' : ' '}`,
    ground: placementGroundOf(choice),
    reach: flippable ? EFooterItemReach.Keyboard : EFooterItemReach.None,
    onActivate: flippable ? choice.onFlip : undefined,
  })
}

export function locationPillOf(args: {
  placed: boolean
  placement?: PlacementChoice | null | undefined
}): FooterItem | null {
  if (args.placement !== undefined && args.placement !== null) return placementChipOf(args.placement)
  if (!args.placed) return null

  return chipItem({
    id: 'execution-location',
    text: 'cloud',
    ground: theme.link,
    reach: EFooterItemReach.None,
  })
}
