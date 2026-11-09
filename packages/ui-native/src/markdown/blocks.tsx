import { space } from '@dltech/atlas-ui/tokens'
import { ScrollView, StyleSheet, View } from 'react-native'

import { withAlpha } from '../color'
import { Text } from '../text'
import { EFontFamily, EFontWeight, ETextRole, ETextTone, RELAXED_LEADING } from '../text-style'
import { useIsDark, useTheme } from '../use-theme'
import { Inline } from './spans'
import { EMdBlock, type MdBlock } from './parse'
import { type IInlineStyle, styles } from './styles'

const CodeBlock = ({ block }: { block: Extract<MdBlock, { type: EMdBlock.Code }> }) => {
  const theme = useTheme()
  const dark = useIsDark()
  return (
    <View
      style={[
        styles.code,
        {
          borderColor: theme.input,
          backgroundColor: dark ? withAlpha({ color: theme.input, alpha: 0.3 }) : 'transparent',
        },
      ]}
    >
      <View style={styles.codeHeader}>
        <Text size={ETextRole.Xs} family={EFontFamily.Mono} tone={ETextTone.Muted}>
          {block.language === undefined || block.language.length === 0 ? 'text' : block.language}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text
          size={ETextRole.Xs}
          family={EFontFamily.Mono}
          leading={RELAXED_LEADING}
          selectable
          style={styles.codeBody}
        >
          {block.value}
        </Text>
      </ScrollView>
    </View>
  )
}

const List = ({
  block,
  selectable,
  style,
}: {
  block: Extract<MdBlock, { type: EMdBlock.List }>
  selectable: boolean
  style: IInlineStyle
}) => (
  <View style={styles.list}>
    {block.items.map((item, index) => (
      <View
        key={`${item.depth}-${index}`}
        style={[styles.listRow, { paddingLeft: space(2) * item.depth }]}
      >
        <Text
          size={style.size}
          tone={ETextTone.Muted}
          leading={RELAXED_LEADING}
          style={styles.marker}
        >
          {item.marker}
        </Text>
        <View style={[styles.fill, styles.listText]}>
          <Inline spans={item.spans} selectable={selectable} style={style} />
        </View>
      </View>
    ))}
  </View>
)

const Table = ({
  block,
  selectable,
  style,
}: {
  block: Extract<MdBlock, { type: EMdBlock.Table }>
  selectable: boolean
  style: IInlineStyle
}) => {
  const theme = useTheme()
  const header: IInlineStyle = { ...style, size: ETextRole.Xs, weight: EFontWeight.Semibold }
  const body: IInlineStyle = { ...style, size: ETextRole.Xs }
  const rows = [
    { cells: block.header, style: header },
    ...block.rows.map((cells) => ({ cells, style: body })),
  ]
  return (
    <View style={[styles.table, { borderColor: theme.border }]}>
      {rows.map((row, rowIndex) => (
        <View
          key={`row-${rowIndex}`}
          style={[
            styles.tableRow,
            {
              backgroundColor: rowIndex === 0 ? theme.muted : 'transparent',
              borderTopColor: theme.border,
              borderTopWidth: rowIndex === 0 ? 0 : StyleSheet.hairlineWidth,
            },
          ]}
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

export { CodeBlock, List, Table }
