import { View } from 'react-native'

import { ETextTone } from '../text-style'
import { useTheme } from '../use-theme'
import { CodeBlock, List, Table } from './blocks'
import { Inline } from './spans'
import { EMdBlock, type MdBlock, parseMarkdown } from './parse'
import { BODY, FALLBACK_HEADING, HEADINGS, type IInlineStyle, styles } from './styles'

export interface IMarkdownProps {
  value: string
  selectable?: boolean
  breaks?: boolean
  tone?: ETextTone
}

const Block = ({
  block,
  selectable,
  tone = ETextTone.Foreground,
}: {
  block: MdBlock
  selectable: boolean
  tone?: ETextTone
}) => {
  const theme = useTheme()
  const style: IInlineStyle = { ...BODY, tone }
  if (block.type === EMdBlock.Paragraph) {
    return <Inline spans={block.spans} selectable={selectable} style={style} />
  }
  if (block.type === EMdBlock.Heading) {
    const heading = HEADINGS[block.level - 1] ?? FALLBACK_HEADING
    return (
      <Inline
        spans={block.spans}
        selectable={selectable}
        style={{ ...heading, uppercase: block.level === 6 }}
      />
    )
  }
  if (block.type === EMdBlock.List) {
    return <List block={block} selectable={selectable} style={style} />
  }
  if (block.type === EMdBlock.Code) return <CodeBlock block={block} />
  if (block.type === EMdBlock.Table) {
    return <Table block={block} selectable={selectable} style={style} />
  }
  if (block.type === EMdBlock.Rule) {
    return <View style={[styles.rule, { backgroundColor: theme.border }]} />
  }
  return (
    <View style={[styles.quote, { borderLeftColor: theme.border }]}>
      {block.blocks.map((inner, index) => (
        <Block
          key={`${inner.type}-${index}`}
          block={inner}
          selectable={selectable}
          tone={ETextTone.Muted}
        />
      ))}
    </View>
  )
}

export const Markdown = ({
  value,
  selectable = false,
  breaks = false,
  tone = ETextTone.Foreground,
}: IMarkdownProps) => (
  <View style={styles.root}>
    {parseMarkdown(value, { breaks }).map((block, index) => (
      <Block key={`${block.type}-${index}`} block={block} selectable={selectable} tone={tone} />
    ))}
  </View>
)
