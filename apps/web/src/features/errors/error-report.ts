import { webBuild, versionLines } from '@/lib/build-info'
import { CloudApiError } from '@/lib/cloud-api'

const MAX_SUMMARY_LENGTH = 240
const REFERENCE_ID_LENGTH = 12
const EMPTY_MESSAGE = '(no message)'

export interface IErrorReport {
  referenceId: string
  summary: string
  requestId: string | undefined
}

export const truncate = (text: string, max: number = MAX_SUMMARY_LENGTH): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

export const newReferenceId = (): string =>
  `err_${crypto.randomUUID().replaceAll('-', '').slice(0, REFERENCE_ID_LENGTH)}`

export const summaryOf = (error: Error): string => {
  const message = error.message.length > 0 ? error.message : EMPTY_MESSAGE
  return truncate(`${error.name}: ${message}`)
}

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof CloudApiError ? error.requestId : undefined

const digestOf = (error: Error & { digest?: string }): string | undefined => {
  const digest = error.digest
  return typeof digest === 'string' && digest.length > 0 ? digest : undefined
}

export const errorReportOf = (args: {
  error: Error & { digest?: string }
  referenceId: string
}): IErrorReport => ({
  referenceId: digestOf(args.error) ?? args.referenceId,
  summary: summaryOf(args.error),
  requestId: requestIdOf(args.error),
})

export const detailsTextOf = (args: { report: IErrorReport; url: string }): string =>
  [
    args.report.summary,
    `Reference: ${args.report.referenceId}`,
    ...(args.report.requestId === undefined ? [] : [`Request: ${args.report.requestId}`]),
    `URL: ${args.url}`,
    ...versionLines({ web: webBuild(), desktopVersion: null }),
  ].join('\n')
