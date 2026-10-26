export enum ESelectLayout {
  Segmented = 'segmented',
  Dropdown = 'dropdown',
}

const SEGMENTED_MAX_OPTIONS = 3
const SEGMENTED_MAX_LABEL_CHARS = 24

export function humanizeOption(option: string): string {
  const spaced = option.replace(/[-_]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function selectLayout({ options }: { options: readonly string[] }): ESelectLayout {
  if (options.length === 0 || options.length > SEGMENTED_MAX_OPTIONS) return ESelectLayout.Dropdown
  const labelChars = options.reduce((total, option) => total + humanizeOption(option).length, 0)
  return labelChars <= SEGMENTED_MAX_LABEL_CHARS ? ESelectLayout.Segmented : ESelectLayout.Dropdown
}
