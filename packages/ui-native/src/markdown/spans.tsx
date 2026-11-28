import { typeScale } from '@dltech/atlas-ui/tokens'
import type { ReactNode } from 'react'
import { Linking } from 'react-native'

import { Text, TextSpan } from '../text'
import { EFontFamily, EFontWeight, ETextTone, RELAXED_LEADING } from '../text-style'
import { useTheme } from '../use-theme'
import { EMdSpan, type MdSpan } from './parse'
import {
  INLINE_CODE_LEADING_PAD,
  INLINE_CODE_RADIUS,
  INLINE_CODE_TRAILING_PAD,
} from './inline-code-text'
import { INLINE_CODE_SCALE, type IInlineStyle, styles } from './styles'

export const Spans = ({
  spans,
  style,
  selectable,
}: {
  spans: MdSpan[]
  style: IInlineStyle
  selectable: boolean
}): ReactNode => {
  const theme = useTheme()
  return spans.map((span, index) => {
    const key = `${span.type}-${index}`
    if (span.type === EMdSpan.Text) return <TextSpan key={key}>{span.value}</TextSpan>
    if (span.type === EMdSpan.Code) {
      return (
        <Text
          key={key}
          size={style.size}
          family={EFontFamily.Mono}
          color={theme.code}
          selectable={selectable}
          style={{
            backgroundColor: theme.codeBackground,
            borderRadius: INLINE_CODE_RADIUS,
            fontSize: typeScale[style.size].fontSize * INLINE_CODE_SCALE,
          }}
        >
          <InlineCodePad size={style.size} selectable={selectable}>
            {INLINE_CODE_LEADING_PAD}
          </InlineCodePad>
          {span.value}
          <InlineCodePad size={style.size} selectable={selectable}>
            {INLINE_CODE_TRAILING_PAD}
          </InlineCodePad>
        </Text>
      )
    }
    const children = <Spans spans={span.children} style={style} selectable={selectable} />
    if (span.type === EMdSpan.Strong) {
      return (
        <Text
          key={key}
          size={style.size}
          tone={style.tone}
          weight={EFontWeight.Semibold}
          selectable={selectable}
        >
          {children}
        </Text>
      )
    }
    if (span.type === EMdSpan.Em) {
      return (
        <Text
          key={key}
          size={style.size}
          tone={style.tone}
          weight={style.weight}
          selectable={selectable}
          style={styles.em}
        >
          {children}
        </Text>
      )
    }
    if (span.type === EMdSpan.Strike) {
      return (
        <Text
          key={key}
          size={style.size}
          tone={style.tone}
          weight={style.weight}
          selectable={selectable}
          style={styles.strike}
        >
          {children}
        </Text>
      )
    }
    const handlePress = () => {
      void Linking.openURL(span.href).catch(() => undefined)
    }
    return (
      <Text
        key={key}
        size={style.size}
        tone={ETextTone.Link}
        weight={EFontWeight.Medium}
        accessibilityRole="link"
        selectable={selectable}
        onPress={handlePress}
      >
        {children}
      </Text>
    )
  })
}

const InlineCodePad = ({
  size,
  selectable,
  children,
}: {
  size: IInlineStyle['size']
  selectable: boolean
  children: string
}) => (
  <Text size={size} family={EFontFamily.Sans} selectable={selectable}>
    {children}
  </Text>
)

export const Inline = ({
  spans,
  selectable,
  style,
}: {
  spans: MdSpan[]
  selectable: boolean
  style: IInlineStyle
}) => (
  <Text
    size={style.size}
    tone={style.tone}
    weight={style.weight}
    leading={style.leading ?? RELAXED_LEADING}
    selectable={selectable}
    style={style.uppercase === true ? styles.uppercase : undefined}
  >
    <Spans spans={spans} style={style} selectable={selectable} />
  </Text>
)
