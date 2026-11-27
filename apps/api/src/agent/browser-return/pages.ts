import { EReturnResult, type ReturnOutcome } from '@dltech/atlas-core'

const BODY_STYLE = 'margin:0;padding:2.5rem;font:16px/1.5 system-ui,sans-serif;color:#1c1c1c'

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const scriptLiteral = (value: string): string =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('<', '\\u003c')}"`

export const gonePageOf = (): string =>
  [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Sign-in link expired</title></head>',
    `<body style="${BODY_STYLE}">`,
    '<p>This sign-in link expired or was already used. Ask Atlas to start the sign-in again.</p>',
    '</body></html>',
  ].join('')

const outcomeTextOf = (outcome: ReturnOutcome): string =>
  outcome.result === EReturnResult.Connected
    ? 'Signed in. Continue in Atlas.'
    : `Couldn't finish the sign-in: ${outcome.reason ?? 'no reason given'}.`

export const continuePageOf = (args: {
  deepLink: string
  webUrl: string
  outcome: ReturnOutcome
}): string =>
  [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Continue in Atlas</title></head>',
    `<body style="${BODY_STYLE}">`,
    `<p>${escapeHtml(outcomeTextOf(args.outcome))}</p>`,
    `<p><a href="${escapeHtml(args.deepLink)}">Open Atlas</a></p>`,
    `<p><a href="${escapeHtml(args.webUrl)}">Continue in the browser</a></p>`,
    `<script>location.href = ${scriptLiteral(args.deepLink)}</script>`,
    '</body></html>',
  ].join('')
