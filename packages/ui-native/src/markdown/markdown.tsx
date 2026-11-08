import { radius, space } from '@dltech/atlas-ui/tokens'
import { Fragment, type ReactNode } from 'react'
import { Linking, ScrollView, StyleSheet, View } from 'react-native'

import { Text } from '../text'
import { EFontFamily, EFontWeight, ETextRole, ETextTone } from '../text-style'
import { useTheme } from '../use-theme'
import { EMdBlock, EMdSpan, type MdBlock, type MdSpan, parseMarkdown } from './parse'

interface IMarkdownProps {
  value: string
  selectable?: boolean
  breaks?: boolean
}

interface IInlineStyle {
  size: ETextRole
  weight: EFontWeight
  tone: ETextTone
}

const BULLET_GUTTER = space(6)
const HEADING_ROLES = [
  ETextRole.Xxl,
  ETextRole.Xl,
  ETextRole.Lg,
  ETextRole.Base,
  ETextRole.Base,
  ETextRole.Sm,
]

const Spans = ({
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
    if (span.type === EMdSpan.Text) return <Fragment key={key}>{span.value}</Fragment>
    if (span.type === EMdSpan.Code) {
      return (
        <Text
          key={key}
          size={style.size}
          family={EFontFamily.Mono}
          style={{ backgroundColor: theme.muted }}
        >
          {` ${span.value} `}
        </Text>
      )
    }
    const children = <Spans spans={span.children} style={style} selectable={selectable} />
    if (span.type === EMdSpan.Strong) {
      return (
        <Text key={key} size={style.size} tone={style.tone} weight={EFontWeight.Semibold}>
          {children}
        </Text>
      )
    }
    if (span.type === EMdSpan.Em) {
      return (
        <Text key={key} size={style.size} tone={style.tone} weight={style.weight} style={styles.em}>
          {children}
        </Text>
      )
    }
    if (span.type === EMdSpan.Strike) {
      return (
        <Text key={key} size={style.size} tone={style.tone} style={styles.strike}>
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
        tone={ETextTone.Primary}
        accessibilityRole="link"
        style={styles.link}
        onPress={handlePress}
      >
        {children}
      </Text>
    )
  })
}

const Inline = ({
  spans,
  selectable,
  style,
}: {
  spans: MdSpan[]
  selectable: boolean
  style: IInlineStyle
}) => (
  <Text size={style.size} tone={style.tone} weight={style.weight} selectable={selectable}>
    <Spans spans={spans} style={style} selectable={selectable} />
  </Text>
)

const BODY: IInlineStyle = {
  size: ETextRole.Sm,
  weight: EFontWeight.Regular,
  tone: ETextTone.Foreground,
}

const CodeBlock = ({ value }: { value: string }) => {
  const theme = useTheme()
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ backgroundColor: theme.muted, borderRadius: radius(1) }}
      contentContainerStyle={{ padding: space(2) }}
    >
      <Text size={ETextRole.Sm} family={EFontFamily.Mono} selectable>
        {value}
      </Text>
    </ScrollView>
  )
}

const List = ({
  block,
  selectable,
}: {
  block: Extract<MdBlock, { type: EMdBlock.List }>
  selectable: boolean
}) => (
  <View style={{ gap: space(1) }}>
    {block.items.map((item, index) => (
      <View
        key={`${item.depth}-${index}`}
        style={{ flexDirection: 'row', paddingLeft: space(2) * item.depth }}
      >
        <View style={{ width: BULLET_GUTTER }}>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            {item.marker}
          </Text>
        </View>
        <View style={styles.fill}>
          <Inline spans={item.spans} selectable={selectable} style={BODY} />
        </View>
      </View>
    ))}
  </View>
)

const Table = ({
  block,
  selectable,
}: {
  block: Extract<MdBlock, { type: EMdBlock.Table }>
  selectable: boolean
}) => {
  const theme = useTheme()
  const header: IInlineStyle = { ...BODY, size: ETextRole.Xs, weight: EFontWeight.Semibold }
  const body: IInlineStyle = { ...BODY, size: ETextRole.Xs }
  const rows = [
    { cells: block.header, style: header },
    ...block.rows.map((cells) => ({ cells, style: body })),
  ]
  return (
    <View>
      {rows.map((row, rowIndex) => (
        <View
          key={`row-${rowIndex}`}
          style={{
            flexDirection: 'row',
            gap: space(2),
            paddingVertical: space(1),
            borderTopWidth: rowIndex === 0 ? 0 : StyleSheet.hairlineWidth,
            borderColor: theme.border,
          }}
        >
          {row.cells.map((cell, cellIndex) => (
            <View key={`cell-${cellIndex}`} style={styles.fill}>
              <Inline spans={cell} selectable={selectable} style={row.style} />
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

const Block = ({ block, selectable }: { block: MdBlock; selectable: boolean }) => {
  const theme = useTheme()
  if (block.type === EMdBlock.Paragraph) {
    return <Inline spans={block.spans} selectable={selectable} style={BODY} />
  }
  if (block.type === EMdBlock.Heading) {
    const size = HEADING_ROLES[block.level - 1] ?? ETextRole.Base
    const style = { ...BODY, size, weight: EFontWeight.Semibold }
    return <Inline spans={block.spans} selectable={selectable} style={style} />
  }
  if (block.type === EMdBlock.List) return <List block={block} selectable={selectable} />
  if (block.type === EMdBlock.Code) return <CodeBlock value={block.value} />
  if (block.type === EMdBlock.Table) return <Table block={block} selectable={selectable} />
  if (block.type === EMdBlock.Rule) {
    return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border }} />
  }
  return (
    <View
      style={{
        borderLeftWidth: 2,
        borderColor: theme.border,
        paddingLeft: space(3),
        gap: space(2),
      }}
    >
      {block.blocks.map((inner, index) => (
        <Block key={`${inner.type}-${index}`} block={inner} selectable={selectable} />
      ))}
    </View>
  )
}

export const Markdown = ({ value, selectable = false, breaks = false }: IMarkdownProps) => (
  <View style={{ gap: space(3) }}>
    {parseMarkdown(value, { breaks }).map((block, index) => (
      <Block key={`${block.type}-${index}`} block={block} selectable={selectable} />
    ))}
  </View>
)

const styles = StyleSheet.create({
  fill: { flex: 1 },
  em: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { textDecorationLine: 'underline' },
})
