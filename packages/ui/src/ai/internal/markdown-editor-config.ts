import type { CodeBlockLanguage, ToMarkdownOptions, Translation } from '@mdxeditor/editor'

export const MARKDOWN_EXPORT_OPTIONS: ToMarkdownOptions = {
  bullet: '-',
  emphasis: '*',
  strong: '*',
  rule: '-',
  fences: true,
  listItemIndent: 'one',
}

export const CODE_BLOCK_LANGUAGES: CodeBlockLanguage[] = [
  { name: 'Plain text', alias: [''], extensions: ['txt'] },
  { name: 'Shell', alias: ['bash', 'sh', 'zsh', 'shell'] },
  { name: 'TypeScript', alias: ['ts', 'typescript'] },
  { name: 'TSX', alias: ['tsx'] },
  { name: 'JavaScript', alias: ['js', 'javascript'] },
  { name: 'JSON', alias: ['json'] },
  { name: 'YAML', alias: ['yaml', 'yml'] },
  { name: 'Markdown', alias: ['md', 'markdown'] },
  { name: 'CSS', alias: ['css'] },
  { name: 'HTML', alias: ['html'] },
  { name: 'Python', alias: ['py', 'python'] },
  { name: 'Diff', alias: ['diff'] },
]

const EDITABLE_AREA_LABEL_KEY = 'contentArea.editableMarkdown'

export function createTranslation({ ariaLabel }: { ariaLabel: string | undefined }): Translation {
  return (key, defaultValue, interpolations = {}) => {
    if (key === EDITABLE_AREA_LABEL_KEY && ariaLabel) return ariaLabel
    return Object.entries(interpolations).reduce(
      (text, [name, replacement]) => text.replaceAll(`{{${name}}}`, String(replacement)),
      defaultValue,
    )
  }
}
