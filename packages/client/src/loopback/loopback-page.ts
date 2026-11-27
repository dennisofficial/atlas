import { EReturnResult, type ReturnOutcome } from '@dltech/atlas-core'

export type LoopbackCopy = {
  connected: string
  failed: (reason?: string | undefined) => string
}

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const PAGE_STYLE =
  'body{margin:4rem auto;max-width:34rem;padding:0 1.5rem;font-family:ui-sans-serif,system-ui,sans-serif;color:#16181d}h1{margin:0 0 .5rem;font-size:1.25rem}p{margin:0;color:#5a616e}'

const copyTextOf = (args: { copy: LoopbackCopy; outcome: ReturnOutcome }): string =>
  args.outcome.result === EReturnResult.Failed
    ? args.copy.failed(args.outcome.reason)
    : args.copy.connected

export const loopbackPageOf = (args: { copy: LoopbackCopy; outcome: ReturnOutcome }): string => {
  const text = escapeHtml(copyTextOf(args))

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${text}</title>`,
    `<style>${PAGE_STYLE}</style>`,
    '</head>',
    '<body>',
    `<h1>${text}</h1>`,
    '<p>You can close this tab.</p>',
    '</body>',
    '</html>',
  ].join('')
}
