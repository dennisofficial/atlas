export type ReplyTarget = {
  owner: string
  repo: string
  issueNumber: number
}

// GitHub login grammar: alnum and hyphens, never a leading hyphen, never a dot.
const OWNER = String.raw`(?<owner>[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))`
const REPO = String.raw`(?<repo>[A-Za-z0-9_.-]+)`
const ISSUE_ID = new RegExp(String.raw`^${OWNER}\/${REPO}#(?<number>[1-9]\d*)$`)
const PULL_ID = new RegExp(String.raw`^${OWNER}\/${REPO}\/pull\/(?<number>[1-9]\d*)$`)

const isDotEscape = (segment: string): boolean => segment === '.' || segment === '..'

/** Both alias grammars accept comments through the issues API: a pull request is an issue there. */
export function parseReplyTarget(externalId: string): ReplyTarget | null {
  const match = ISSUE_ID.exec(externalId) ?? PULL_ID.exec(externalId)
  const groups = match?.groups
  const { owner, repo, number } = groups ?? {}
  if (owner === undefined || repo === undefined || number === undefined) return null
  if (isDotEscape(repo)) return null
  return { owner, repo, issueNumber: Number(number) }
}
