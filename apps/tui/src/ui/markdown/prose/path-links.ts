import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

const HOME_PREFIX = '~/'

/**
 * The verdict behind every file-path link the transcript draws: the same check decides the
 * highlight, the hover and the click, because the markdown layer keeps no link without one.
 * Verdicts are cached by the matched text for the process — a file deleted mid-session keeps
 * its link, which fails open in the editor exactly as an unchecked link did.
 */
const verdicts = new Map<string, string | null>()

const SLASHED = /^(?:\/|~\/|\.{1,2}\/|(?:[\w~+-][\w.~+-]*\/))/

const KNOWN_EXTENSION = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|py|go|rs|java|rb|yml|yaml|toml|css|html|sh)$/

/**
 * Slash-joined candidates are the noise source — prose like `lift/descend` matches the regex —
 * so only they pay an existence check. A bare `package.json` mention stays linked unchecked:
 * stats on every inline-code noun would flicker links as files come and go.
 */
export function canLinkPath(candidate: string): string | null {
  if (!SLASHED.test(candidate)) return KNOWN_EXTENSION.test(candidate) ? candidate : null
  const hit = verdicts.get(candidate)
  if (hit !== undefined) return hit
  const verdict = checked(candidate)
  verdicts.set(candidate, verdict)
  return verdict
}

function checked(candidate: string): string | null {
  const path = candidate.startsWith(HOME_PREFIX)
    ? resolve(homedir(), candidate.slice(HOME_PREFIX.length))
    : isAbsolute(candidate)
      ? candidate
      : resolve(candidate)
  return existsSync(path) ? path : null
}

export function resetPathLinkVerdicts(): void {
  verdicts.clear()
}
