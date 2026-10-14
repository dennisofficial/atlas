import { EExecutionLocation, EHarnessPlacement } from '@dltech/atlas-core'

import { chipItem, EFooterItemReach, type FooterItem } from './footer-item'
import { theme } from './theme'

export const PLACEMENT_CHIP_ID = 'placement-chip'

export type PlacementChoice = {
  harness: EHarnessPlacement
  provisioning: boolean
  onFlip: () => void
}

function placementChipOf(choice: PlacementChoice): FooterItem {
  const cloud = choice.harness === EHarnessPlacement.Cloud
  const flippable = !choice.provisioning
  return chipItem({
    id: PLACEMENT_CHIP_ID,
    text: `${cloud ? ' ☁ cloud' : ' local'}${flippable ? ' ▾ ' : ' '}`,
    ground: choice.provisioning ? theme.warn : cloud ? theme.link : theme.hint,
    reach: flippable ? EFooterItemReach.Keyboard : EFooterItemReach.None,
    onActivate: flippable ? choice.onFlip : undefined,
  })
}

export function locationPillOf(args: {
  location: EExecutionLocation
  placement?: PlacementChoice | null | undefined
}): FooterItem | null {
  if (args.placement !== undefined && args.placement !== null) return placementChipOf(args.placement)
  if (args.location === EExecutionLocation.Host) return null

  return chipItem({
    id: 'execution-location',
    text: args.location,
    ground: theme.link,
    reach: EFooterItemReach.None,
  })
}
