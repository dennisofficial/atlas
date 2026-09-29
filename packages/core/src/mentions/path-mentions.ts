import { expandHome } from '../paths/home-paths'

export type PathMention = {
  readonly text: string
  readonly path: string
  readonly line?: number
}

/**
 * A `path[:line[:column]]` mention in prose. The leading lookbehind refuses a match that starts
 * mid-URL (`https://…/a.ts:9`), mid-token (`package.json5`), or on the slash of an HTML closing
 * tag (`</summary>`); the bare-filename alternative needs a known extension so plain words never
 * match, while any slash-joined or absolute path matches extension-free.
 */
export const PATH_MENTION =
  /(?<![\w/@:~+.<-])(?:\/[\w.@~+-][\w.@~+\-/]*|(?:\.{1,2}\/|~\/)[\w.@~+\-/]*|(?:[\w~+-][\w.~+-]*\/)+[\w.~+-]*|[\w~+-][\w.~+-]*\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|py|go|rs|java|rb|yml|yaml|toml|css|html|sh)\b)(?::(\d+))?(?::(\d+))?/g

export function pathMentions(text: string): readonly PathMention[] {
  const mentions: PathMention[] = []
  for (const hit of text.matchAll(PATH_MENTION)) {
    const line = hit[1] === undefined ? undefined : Number(hit[1])
    mentions.push({
      text: hit[0],
      path: hit[0].replace(/:\d+(:\d+)?$/, ''),
      ...(line === undefined ? {} : { line }),
    })
  }
  return mentions
}

const LINE_SUFFIX = /:(\d+)(?::\d+)?$/

export function parseLineSuffix(raw: string): { path: string; line?: number } {
  const suffix = LINE_SUFFIX.exec(raw)
  const line = suffix?.[1]
  if (suffix === null || line === undefined) return { path: raw }
  return { path: raw.slice(0, raw.length - suffix[0].length), line: Number(line) }
}

export function resolveMentionAgainst(args: { mention: string; root: string; home: string }): string {
  if (args.mention.startsWith('/')) return args.mention
  if (args.mention.startsWith('~')) return expandHome({ path: args.mention, home: args.home })
  const root = args.root.endsWith('/') ? args.root.slice(0, -1) : args.root
  return `${root}/${args.mention}`
}
