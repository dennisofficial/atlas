import { BRAND_PATHS, type EBrand } from '@dltech/atlas-ui/brand'
import Svg, { Path } from 'react-native-svg'

export const BrandMark = ({
  brand,
  size,
  color,
}: {
  brand: EBrand
  size: number
  color: string
}) => {
  const { title, d, fill } = BRAND_PATHS[brand]
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={title}>
      <Path fill={fill ?? color} fillRule="evenodd" d={d} />
    </Svg>
  )
}
