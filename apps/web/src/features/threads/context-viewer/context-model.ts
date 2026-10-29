import type { ContextFileContentWire } from '@dltech/atlas-wire/web'

const MARKDOWN_PATH = /\.(md|markdown|mdx)$/i

export const isMarkdownPath = (path: string): boolean => MARKDOWN_PATH.test(path)

export const copyTextOf = (file: ContextFileContentWire): string | null =>
  file.type === 'text' ? file.content : null
