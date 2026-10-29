import { EExecutionLocation, EHarnessPlacement, ERunner } from '@dltech/atlas-core'

import { chipItem, EFooterItemReach, type FooterItem } from './footer-item'
import { theme } from './theme'

export const PLACEMENT_CHIP_ID = 'placement-chip'

export type PlacementChoice = {
  harness: EHarnessPlacement
  runner?: ERunner | undefined
  provisioning: boolean
  onFlip?: (() => void) | undefined
}

const placementLabelOf = (choice: PlacementChoice): string => {
  if (choice.harness !== EHarnessPlacement.Cloud) return ' host'
  return choice.runner === ERunner.Local ? ' pod' : ' ☁ cloud'
}

const placementGroundOf = (choice: PlacementChoice): string => {
  if (choice.provisioning) return theme.warn
  return choice.harness === EHarnessPlacement.Cloud ? theme.link : theme.hint
}

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
  location: EExecutionLocation
  placement?: PlacementChoice | null | undefined
  runner?: ERunner | undefined
}): FooterItem | null {
  if (args.placement !== undefined && args.placement !== null)
    return placementChipOf(args.placement)
  if (args.location === EExecutionLocation.Host) return null

  const text =
    args.location === EExecutionLocation.Cloud
      ? ` ${args.runner === ERunner.Local ? 'pod' : '☁ cloud'} `
      : args.location
  return chipItem({
    id: 'execution-location',
    text,
    ground: theme.link,
    reach: EFooterItemReach.None,
  })
}
