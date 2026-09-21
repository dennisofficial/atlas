export type ReplyTarget = {
  owner: string
  repo: string
  issueNumber: number
}

const SEGMENT = String.raw`(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+)`
const ISSUE_ID = new RegExp(String.raw`^${SEGMENT}#(?<number>[1-9]\d*)$`)
const PULL_ID = new RegExp(String.raw`^${SEGMENT}\/pull\/(?<number>[1-9]\d*)$`)

/** Both alias grammars accept comments through the issues API: a pull request is an issue there. */
export function parseReplyTarget(externalId: string): ReplyTarget | null {
  const match = ISSUE_ID.exec(externalId) ?? PULL_ID.exec(externalId)
  const groups = match?.groups
  if (groups === undefined) return null
  return {
    owner: groups.owner as string,
    repo: groups.repo as string,
    issueNumber: Number(groups.number),
  }
}
