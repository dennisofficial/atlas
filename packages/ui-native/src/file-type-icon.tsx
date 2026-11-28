import { artOf, EIconPart, FILE_ICON_ART, fileIconOf } from '@dltech/atlas-ui/file-icons'
import Svg, { Path } from 'react-native-svg'

import { iconFillOf } from './file-type-icon-fill'
import { useTheme } from './use-theme'

export const FileTypeIcon = ({
  name,
  folder = false,
  open = false,
  colored = false,
  size = 16,
}: {
  name: string
  folder?: boolean
  open?: boolean
  colored?: boolean
  size?: number
}) => {
  const theme = useTheme()
  const icon = fileIconOf({ name, folder })
  return (
    <Svg width={size} height={size} viewBox={FILE_ICON_ART[icon].viewBox} accessible={false}>
      {artOf({ icon, open }).map((path, index) => (
        <Path
          key={`${path.part}-${index}`}
          d={path.d}
          fillRule={path.fillRule ?? 'nonzero'}
          fill={iconFillOf({
            path,
            colored,
            foreground: theme.foreground,
            muted: theme.mutedForeground,
          })}
          fillOpacity={!colored && path.part === EIconPart.Body ? 0.45 : 1}
        />
      ))}
    </Svg>
  )
}
