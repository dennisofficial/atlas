import type { ChangedFile } from './changes-types'

export function formatCount(count: number): string {
  if (count < 1000) return `${count}`
  const thousands = count / 1000
  const rounded = thousands < 10 ? Math.round(thousands * 10) / 10 : Math.round(thousands)
  return `${rounded}k`
}

export function totalChanges(files: ChangedFile[]): {
  added: number
  removed: number
} {
  return files.reduce(
    (total, file) => ({
      added: total.added + file.added,
      removed: total.removed + file.removed,
    }),
    { added: 0, removed: 0 },
  )
}

export function splitPath(path: string): { name: string; dir: string } {
  const index = path.lastIndexOf('/')
  if (index === -1) return { name: path, dir: '' }
  return { name: path.slice(index + 1), dir: path.slice(0, index) }
}
