import type { ContextFileContentWire } from '@dltech/atlas-wire/web'

const MARKDOWN_PATH = /\.(md|markdown|mdx)$/i
const HTML_PATH = /\.html?$/i

export enum ERenderKind {
  Markdown = 'markdown',
  Html = 'html',
}

export const isMarkdownPath = (path: string): boolean => MARKDOWN_PATH.test(path)

export const renderKindOf = (path: string): ERenderKind | null => {
  if (isMarkdownPath(path)) return ERenderKind.Markdown
  if (HTML_PATH.test(path)) return ERenderKind.Html
  return null
}

export const copyTextOf = (file: ContextFileContentWire): string | null =>
  file.type === 'text' ? file.content : null
