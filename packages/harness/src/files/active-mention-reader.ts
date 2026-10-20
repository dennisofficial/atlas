import type { MentionReader } from './mention-reader'
import { UnavailableMentionFiles } from './unavailable-mention-files'

const unavailable = new UnavailableMentionFiles()

export function activeMentionReader(args: {
  reader: MentionReader
  placed: boolean
  bound: boolean
}): MentionReader {
  return args.placed && !args.bound ? unavailable : args.reader
}
