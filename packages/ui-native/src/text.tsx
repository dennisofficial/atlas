import { Text as NativeText, type TextProps } from 'react-native'

import {
  EFontFamily,
  EFontWeight,
  ETextRole,
  ETextTone,
  textStyleOf,
  toneColorOf,
} from './text-style'
import { useTheme } from './use-theme'

export interface ITextProps extends TextProps {
  size?: ETextRole
  tone?: ETextTone
  family?: EFontFamily
  weight?: EFontWeight
  tight?: boolean
  leading?: number
  color?: string | undefined
}

export const Text = ({
  size = ETextRole.Sm,
  tone = ETextTone.Foreground,
  family = EFontFamily.Sans,
  weight = EFontWeight.Regular,
  tight = false,
  leading,
  color,
  style,
  ...props
}: ITextProps) => {
  const theme = useTheme()
  return (
    <NativeText
      {...props}
      style={[
        textStyleOf({
          role: size,
          family,
          weight,
          tight,
          ...(leading === undefined ? {} : { leading }),
        }),
        { color: color ?? toneColorOf({ tone, theme }) },
        style,
      ]}
    />
  )
}
