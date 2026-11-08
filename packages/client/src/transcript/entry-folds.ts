import { EEntryKind, type TranscriptEntry } from './transcript-model'

export function inOneBreath(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  const folded: TranscriptEntry[] = []

  for (const entry of entries) {
    const open = folded.at(-1)
    if (
      entry.kind !== EEntryKind.OperatorSaid ||
      open?.kind !== EEntryKind.OperatorSaid ||
      open.steer !== entry.steer
    ) {
      folded.push(entry)
      continue
    }

    folded[folded.length - 1] = {
      ...open,
      text: `${open.text}\n${entry.text}`,
      said: [...open.said, ...entry.said],
      skills: [...new Set([...open.skills, ...entry.skills])],
      files: [...new Set([...open.files, ...entry.files])],
      attachments: [...open.attachments, ...entry.attachments],
    }
  }

  return folded
}
