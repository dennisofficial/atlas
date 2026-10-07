import { FileBrowser } from './file-browser'
import type { MentionReader } from './mention-reader'

export const rebaseMentionReader = (args: { reader: MentionReader; root: string }): MentionReader =>
  args.reader instanceof FileBrowser ? args.reader.atRoot(args.root) : args.reader
