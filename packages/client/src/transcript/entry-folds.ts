import { EExecutionLocation, type ELocationChangeCause } from '@dltech/atlas-core'

import { EAuthor, EEntryKind, type TranscriptEntry } from './transcript-model'

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
      images: [...open.images, ...entry.images],
    }
  }

  return folded
}

export const locationChangedEntry = (args: {
  key: string
  to: EExecutionLocation
  cause?: ELocationChangeCause | undefined
}): TranscriptEntry => {
  const text =
    args.to === EExecutionLocation.Docker
      ? 'docker container'
      : args.to === EExecutionLocation.Cloud
        ? 'cloud sandbox'
        : 'host'
  return {
    kind: EEntryKind.LocationChanged,
    author: EAuthor.Model,
    key: args.key,
    text,
    to: args.to,
    cause: args.cause,
  }
}
