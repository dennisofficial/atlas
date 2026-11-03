import { EFontFamily, EFontWeight, ETextRole, radius, space } from '@dltech/atlas-ui/tokens'
import { type ComponentRef, forwardRef, useState } from 'react'
import { TextInput, type TextInputProps } from 'react-native'

import { withAlpha } from './color'
import { textStyleOf } from './text-style'
import { useIsDark, useTheme } from './use-theme'

export interface IInputProps extends TextInputProps {
  bare?: boolean
}

export type InputRef = ComponentRef<typeof TextInput>

export const Input = forwardRef<InputRef, IInputProps>(
  ({ bare = false, multiline, style, onFocus, onBlur, ...props }, ref) => {
    const theme = useTheme()
    const dark = useIsDark()
    const [focused, setFocused] = useState(false)
    const frame = bare
      ? { outlineWidth: 0 }
      : {
          borderWidth: 1,
          borderRadius: radius(1),
          borderColor: focused ? theme.ring : theme.input,
          backgroundColor: dark ? withAlpha({ color: theme.input, alpha: 0.3 }) : 'transparent',
          paddingHorizontal: space(2.5),
          paddingVertical: multiline === true ? space(2) : space(1),
          minHeight: multiline === true ? 64 : 32,
        }
    return (
      <TextInput
        ref={ref}
        multiline={multiline}
        placeholderTextColor={theme.mutedForeground}
        selectionColor={theme.primary}
        onFocus={(event) => {
          setFocused(true)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          setFocused(false)
          onBlur?.(event)
        }}
        {...props}
        style={[
          textStyleOf({
            role: ETextRole.Base,
            family: EFontFamily.Sans,
            weight: EFontWeight.Regular,
            tight: false,
          }),
          { color: theme.foreground, textAlignVertical: multiline === true ? 'top' : 'center' },
          frame,
          style,
        ]}
      />
    )
  },
)
