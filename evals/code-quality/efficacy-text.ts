import type { Ratio } from './efficacy-types'
import type { SrpEfficacyReport } from './efficacy-report'

const MAX_LISTED = 10

const ratioText = ({ ratio }: { ratio: Ratio }): string =>
  `${ratio.numerator}/${ratio.denominator}${ratio.value === null ? ' (n/a)' : ` (${ratio.value.toFixed(3)})`}`

const listed = ({ ids }: { ids: readonly string[] }): string => {
  if (ids.length === 0) return 'none'
  const shown = ids.slice(0, MAX_LISTED).join(', ')
  return ids.length > MAX_LISTED ? `${shown} (+${ids.length - MAX_LISTED} more)` : shown
}

export function formatEfficacyText({ report }: { report: SrpEfficacyReport }): string {
  const { concern, notification, abstention, evidence, instability, rows, independent } = report
  const lines = [
    `SRP efficacy pilot: ${report.diagnosticStatus} (not promotable)`,
    report.statement,
    `independent cases ${independent.cases}, groups ${independent.groups}, judged ${independent.judgedCases}`,
    `0-R mode baseline (in-sample): impact ${report.zeroR.prediction.impact ?? 'none'} accuracy ${ratioText({ ratio: report.zeroR.impactAccuracy })}; concern ${report.zeroR.prediction.currentConcern ?? 'none'} accuracy ${ratioText({ ratio: report.zeroR.concernAccuracy })}; notification ${report.zeroR.prediction.notificationWarranted ?? 'none'}; evidence []`,
    `unjudged notifications ${notification.unjudgedNotifications}`,
    `rows planned ${rows.planned}, interpretable ${rows.interpretable}, operational ${rows.operational.total}, structural ${rows.structural.total}`,
    `decision coverage ${ratioText({ ratio: abstention.decisionCoverage })}; expected abstentions correct ${ratioText({ ratio: abstention.expectedAbstain })}`,
    `unexpected abstentions: positive ${abstention.unexpected.onPositive}, negative ${abstention.unexpected.onNegative}`,
    `impact accuracy all-eligible ${ratioText({ ratio: report.impact.allEligible })}; on decisions ${ratioText({ ratio: report.impact.onDecisions })}`,
    `${concern.threshold.name} accuracy all-eligible ${ratioText({ ratio: concern.allEligibleAccuracy })}; recall all-eligible ${ratioText({ ratio: concern.allEligibleRecall })}`,
    `notification precision ${ratioText({ ratio: notification.precision })}; recall ${ratioText({ ratio: notification.recall })}`,
    `notifications ${notification.actualNotifications}; tp ${notification.confusion.tp} fp ${notification.confusion.fp} fn ${notification.confusion.fn} tn ${notification.confusion.tn}`,
    `wrong-evidence notifications ${ratioText({ ratio: evidence.wrongEvidenceNotifications })}`,
    `unstable outcome groups ${ratioText({ ratio: instability.unstableOutcomes })}; notification flips ${instability.notificationFlips.length}`,
    `latency end-to-end p50 ${report.latency.endToEndMs.p50 ?? 'n/a'}ms p95 ${report.latency.endToEndMs.p95 ?? 'n/a'}ms over ${report.latency.endToEndMs.samples} rows`,
    `coverage-limited warranted cases: ${listed({ ids: notification.coverageLimitedCaseIds })}`,
    `unstable cases: ${listed({ ids: instability.unstable.map((entry) => entry.caseId) })}`,
    'checks:',
    ...report.checks.map((check) => `  ${check.status} ${check.id}: ${check.detail}`),
  ]
  return `${lines.join('\n')}\n`
}
