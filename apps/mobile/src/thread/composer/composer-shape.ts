import { radius, space } from '@dltech/atlas-ui/tokens'

export const concentricRadiusOf = ({ outer, inset }: { outer: number; inset: number }): number =>
  Math.max(0, outer - inset)

export const COMPOSER_RADIUS = radius(2.4)

export const COMPOSER_INSET = space(2.5)

export const CHIP_RADIUS = concentricRadiusOf({ outer: COMPOSER_RADIUS, inset: COMPOSER_INSET })

export const CHIP_REMOVE_INSET = space(1)

export const CHIP_REMOVE_SIZE =
  2 * concentricRadiusOf({ outer: CHIP_RADIUS, inset: CHIP_REMOVE_INSET })
