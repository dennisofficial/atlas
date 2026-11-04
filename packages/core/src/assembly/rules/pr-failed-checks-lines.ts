import { failedCheckLogCommand, type PrFailedCheck } from '../../github/failed-check'

const GITHUB_PREFIX = 'github.com/'

const repoFullNameOf = (repo: string): string =>
  repo.startsWith(GITHUB_PREFIX) ? repo.slice(GITHUB_PREFIX.length) : repo

const indented = (text: string): string => text.split('\n').join('\n    ')

const headOf = (check: PrFailedCheck): string => {
  const app = check.app === undefined ? '' : ` (${check.app})`
  const url = check.url === undefined ? '' : ` ${check.url}`
  return `- ${check.name}${app}${url}`
}

const detailOf = (check: PrFailedCheck): string | undefined => {
  if (check.title !== undefined && check.summary !== undefined) {
    return `${check.title}: ${check.summary}`
  }
  return check.title ?? check.summary
}

const linesOf = (args: { check: PrFailedCheck; repoFullName: string }): string[] => {
  const detail = detailOf(args.check)
  const logs = failedCheckLogCommand(args)
  return [
    headOf(args.check),
    ...(detail === undefined ? [] : [`    ${indented(detail)}`]),
    ...(logs === undefined ? [] : [`    logs: ${logs}`]),
  ]
}

export const failedChecksCountPhrase = (checks: readonly PrFailedCheck[]): string =>
  checks.length === 1 ? 'a check failed' : `${checks.length} checks failed`

export const failedChecksBlock = (args: {
  checks: readonly PrFailedCheck[] | undefined
  repo: string
}): string => {
  if (args.checks === undefined || args.checks.length === 0) return ''
  const repoFullName = repoFullNameOf(args.repo)
  const lines = args.checks.flatMap((check) => linesOf({ check, repoFullName }))
  return `\nFailed checks:\n${lines.join('\n')}`
}
