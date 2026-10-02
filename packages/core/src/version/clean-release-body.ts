const WHATS_CHANGED_HEADING = /^#{1,6}\s+what's changed\s*$/i
const FULL_CHANGELOG_LINE = /^\*\*full changelog\*\*\s*:?\s*/i
const CONTRIBUTOR_HEADING = /^#{1,6}\s+new contributors\s*$/i
const FIRST_CONTRIBUTION = /made their first contribution\b/i
const ATTRIBUTION_TAIL = /\s+by\s+@[\w-]*(?:\[\w+\])?\s+in\s+(?:https?:\/\/\S+|#\d+)\s*$/i

function isDrop(line: string, insideContributorSection: boolean): boolean {
  if (FULL_CHANGELOG_LINE.test(line)) return true
  if (WHATS_CHANGED_HEADING.test(line) || CONTRIBUTOR_HEADING.test(line)) return true
  if (insideContributorSection && FIRST_CONTRIBUTION.test(line)) return true
  return FIRST_CONTRIBUTION.test(line) && /^\s*[-*]\s+@/.test(line)
}

function stripAttribution(line: string): string {
  const stripped = line.replace(ATTRIBUTION_TAIL, '')
  return stripped.trimEnd()
}

export function cleanReleaseBody(body: string): string {
  const lines = body.split('\n')
  const kept: string[] = []
  let insideContributorSection = false

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (WHATS_CHANGED_HEADING.test(line)) continue
    if (CONTRIBUTOR_HEADING.test(line)) {
      insideContributorSection = true
      continue
    }
    if (/^#{1,6}\s/.test(line)) insideContributorSection = false
    if (isDrop(line, insideContributorSection)) continue
    kept.push(stripAttribution(line))
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
