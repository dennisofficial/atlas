import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

import { resolveMentionAgainst } from '@dltech/atlas-core'

export type ResolvedMention = { path: string; line?: number }

export type PathResolver = (mention: { path: string; line?: number }) => ResolvedMention | null

const RESOLVED_LIMIT = 512

/**
 * Ground truth for a slash-joined or dotted mention in rendered prose: it is a link only when it
 * names something that exists. Relative mentions anchor at the project directory, `~/` at the
 * home directory, and absolutes stand alone. Results are cached because the prose pipeline
 * re-resolves on every streamed chunk; the cache is existence truth, not content truth, so a
 * deleted file goes stale only until the next click, which re-checks through `resolveMention`.
 */
export function createPathResolver(args: { root: string; home?: string }): PathResolver {
  const home = args.home ?? homedir()
  const resolved = new Map<string, ResolvedMention | null>()

  return (mention) => {
    const cached = resolved.get(mention.path)
    if (cached !== undefined) return withLine(cached, mention.line)

    const absolute = resolveMentionAgainst({ mention: mention.path, root: args.root, home })
    const found: ResolvedMention | null = existsSync(absolute) ? { path: absolute } : null
    if (resolved.size >= RESOLVED_LIMIT) {
      const oldest = resolved.keys().next()
      if (!oldest.done) resolved.delete(oldest.value)
    }
    resolved.set(mention.path, found)
    return withLine(found, mention.line)
  }
}

function withLine(hit: ResolvedMention | null, line: number | undefined): ResolvedMention | null {
  if (hit === null) return null
  return line === undefined ? hit : { path: hit.path, line }
}
