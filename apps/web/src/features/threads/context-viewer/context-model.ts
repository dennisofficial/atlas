import type { ContextFileContentWire } from '@dltech/atlas-wire/web'

const MARKDOWN_PATH = /\.(md|markdown|mdx)$/i
const HTML_PATH = /\.html?$/i

export enum EContextView {
  Rendered = 'rendered',
  Source = 'source',
}

export const isMarkdownPath = (path: string): boolean => MARKDOWN_PATH.test(path)

export const isHtmlPath = (path: string): boolean => HTML_PATH.test(path)

export const renderableHtmlOf = (args: {
  file: ContextFileContentWire
  path: string
}): string | null => (args.file.type === 'text' && isHtmlPath(args.path) ? args.file.content : null)

export const copyTextOf = (file: ContextFileContentWire): string | null =>
  file.type === 'text' ? file.content : null
