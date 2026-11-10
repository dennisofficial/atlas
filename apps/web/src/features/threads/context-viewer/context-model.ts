import type { ContextFileContentWire } from '@dltech/atlas-wire/web'

const MARKDOWN_PATH = /\.(md|markdown|mdx)$/i
const HTML_PATH = /\.html?$/i

export enum EContextView {
  Rendered = 'rendered',
  Source = 'source',
}

export enum ERenderKind {
  Markdown = 'markdown',
  Html = 'html',
}

export const isMarkdownPath = (path: string): boolean => MARKDOWN_PATH.test(path)

export const isHtmlPath = (path: string): boolean => HTML_PATH.test(path)

export const renderKindOf = (path: string): ERenderKind | null => {
  if (isMarkdownPath(path)) return ERenderKind.Markdown
  if (isHtmlPath(path)) return ERenderKind.Html
  return null
}

export const renderableHtmlOf = (args: {
  file: ContextFileContentWire
  path: string
}): string | null => (args.file.type === 'text' && isHtmlPath(args.path) ? args.file.content : null)

export const copyTextOf = (file: ContextFileContentWire): string | null =>
  file.type === 'text' ? file.content : null

const base64BytesOf = (data: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(data)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export const downloadNameOf = (path: string): string => path.split('/').at(-1) ?? path

export const downloadOf = (file: ContextFileContentWire): Blob | null => {
  if (file.type === 'text') return new Blob([file.content], { type: 'text/plain;charset=utf-8' })
  if (file.type === 'image') return new Blob([base64BytesOf(file.data)], { type: file.mediaType })
  if (file.type === 'binary') return new Blob([base64BytesOf(file.data)])
  return null
}

export const fileSizeLabelOf = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
