import { EFileMountState, type FileMountOutcome, type FileMountReport } from './file-mounts'

const CLOSING_LINE =
  "Atlas writes project files again on every sandbox start, so changes made to them during a session are lost. Change them in the project's Files settings."

const pathsIn = (args: { report: FileMountReport; state: EFileMountState }): string =>
  args.report.outcomes
    .filter((outcome) => outcome.state === args.state)
    .map((outcome) => outcome.path)
    .join(', ')

const couldNotWrite = (outcome: FileMountOutcome): string =>
  outcome.reason === undefined ? outcome.path : `${outcome.path} — ${outcome.reason}`

export const fileMountNoticeOf = (report: FileMountReport): string | null => {
  if (report.outcomes.length === 0) return null
  if (report.outcomes.every((outcome) => outcome.state === EFileMountState.Written)) {
    const paths = report.outcomes.map((outcome) => outcome.path).join(', ')
    return `Atlas wrote the project files: ${paths}.\n\n${CLOSING_LINE}`
  }
  const sentences: string[] = []
  const unexcluded = report.outcomes
    .filter((outcome) => outcome.state === EFileMountState.WrittenNotExcluded)
    .map(couldNotWrite)
  if (unexcluded.length > 0) {
    sentences.push(
      `Atlas wrote these project files but could not add them to .git/info/exclude, so git shows them as untracked changes: ${unexcluded.join('; ')}. Do not commit them; offer a .gitignore line in a pull request.`,
    )
  }
  const excluded = pathsIn({ report, state: EFileMountState.WrittenLocallyExcluded })
  if (excluded !== '') {
    sentences.push(
      `Atlas wrote these project files, which git does not ignore: ${excluded}. Atlas added them to .git/info/exclude, so they are protected in this checkout only. Offer the operator a pull request that adds them to .gitignore.`,
    )
  }
  const tracked = pathsIn({ report, state: EFileMountState.SkippedTracked })
  if (tracked !== '') {
    sentences.push(
      `Atlas did not write these project files, because git tracks them: ${tracked}. Writing them would show as changes to commit. The path is probably wrong, or the file must be untracked first. Tell the operator and offer the fix.`,
    )
  }
  const unwritten = report.outcomes
    .filter(
      (outcome) =>
        outcome.state === EFileMountState.Failed ||
        outcome.state === EFileMountState.SkippedNoRepository,
    )
    .map(couldNotWrite)
  if (unwritten.length > 0) {
    sentences.push(`Atlas could not write these project files: ${unwritten.join('; ')}.`)
  }
  sentences.push(CLOSING_LINE)
  return sentences.join('\n\n')
}
