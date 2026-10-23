import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const atlasHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--foreground)', fontWeight: '600' },
  { tag: tags.strong, color: 'var(--foreground)', fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--link)' },
  { tag: tags.monospace, color: 'var(--syntax-string)' },
  { tag: tags.quote, color: 'var(--muted-foreground)' },
  {
    tag: [tags.processingInstruction, tags.meta, tags.contentSeparator],
    color: 'var(--syntax-punctuation)',
  },
  { tag: tags.keyword, color: 'var(--syntax-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--syntax-string)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--syntax-comment)' },
  { tag: [tags.number, tags.bool, tags.atom, tags.null], color: 'var(--syntax-constant)' },
  { tag: [tags.function(tags.variableName), tags.propertyName], color: 'var(--syntax-function)' },
  { tag: [tags.typeName, tags.className, tags.tagName], color: 'var(--syntax-type)' },
  { tag: [tags.punctuation, tags.bracket, tags.operator], color: 'var(--syntax-punctuation)' },
])

export const ATLAS_CODEMIRROR_EXTENSIONS = [syntaxHighlighting(atlasHighlightStyle)]
