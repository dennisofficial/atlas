const ASSIGNMENT = /^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/
const PUBLIC_KEY = 'DOTENV_PUBLIC_KEY'

export enum ELineFault {
  Unrecognized = 'unrecognized',
  Unencrypted = 'unencrypted',
}

export type LineFault = { line: number; fault: ELineFault; key?: string }

const isCommentOrBlank = (line: string): boolean => line.trim() === '' || line.startsWith('#')

export function lineFaultsOf(text: string): LineFault[] {
  return text.split('\n').flatMap((line, index): LineFault[] => {
    const number = index + 1
    const match = ASSIGNMENT.exec(line)
    if (match === null) {
      return isCommentOrBlank(line) ? [] : [{ line: number, fault: ELineFault.Unrecognized }]
    }
    const [, commented, key = '', raw = ''] = match
    if (commented !== undefined || key.startsWith(PUBLIC_KEY)) return []
    const value = raw.replace(/^"|"$/g, '')
    return value.startsWith('encrypted:')
      ? []
      : [{ line: number, fault: ELineFault.Unencrypted, key }]
  })
}
