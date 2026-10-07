import { renderUnifiedDiff } from '../../tools/builtin/unified-diff'

export function renderScopeDiff(args: {
  path: string
  before: string | null
  after: string | null
}): string {
  if (args.after === null) {
    return renderUnifiedDiff({ path: args.path, oldContent: args.before, newContent: '' })
  }
  return renderUnifiedDiff({ path: args.path, oldContent: args.before, newContent: args.after })
}
