import type { CommandHandler } from '@dltech/atlas-commands'

import { rewindArgs, rewindTargetOf } from './spec'

export const rewindHandler: CommandHandler<unknown> = async ({
  args,
  visibleEvents,
  append,
  log,
}) => {
  const parsed = rewindArgs.safeParse(args)
  if (!parsed.success) return { kind: 'refused', reason: parsed.error.message }
  const { toSeq } = parsed.data
  const target = rewindTargetOf({ events: visibleEvents(), toSeq })
  if (!target.allowed) return { kind: 'refused', reason: target.reason }
  await append([{ type: 'history-rewound', toSeq: toSeq - 1, draft: target.draft }])
  log(`rewound to before seq ${toSeq}`)
  return { kind: 'done' }
}
