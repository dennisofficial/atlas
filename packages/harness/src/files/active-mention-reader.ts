import { EExecutionLocation } from '@dltech/atlas-core'

import type { MentionReader } from './mention-reader'
import { UnavailableMentionFiles } from './unavailable-mention-files'

const unavailable = new UnavailableMentionFiles()

export function activeMentionReader(args: {
  reader: MentionReader
  location: EExecutionLocation
  bound: boolean
}): MentionReader {
  return args.location === EExecutionLocation.Cloud && !args.bound ? unavailable : args.reader
}
