const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export function installLandingPage(args: { accountLogin: string | null }): string {
  const org = args.accountLogin
  const heading = org === null ? 'Atlas is installed' : `Atlas is installed on ${escapeHtml(org)}`
  const detail =
    org === null
      ? 'The Atlas GitHub App is installed. Pull request reviews and comments now stream to Atlas in realtime.'
      : `Pull request reviews and comments on ${escapeHtml(org)} repositories now stream to Atlas in realtime. You can close this tab.`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0d10; color: #e6e8eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  main { max-width: 30rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.75rem; }
  p { color: #9aa0a6; line-height: 1.5; margin: 0; }
  .mark { font-size: 2rem; margin-bottom: 1rem; }
</style>
</head>
<body>
<main>
  <div class="mark">&#10003;</div>
  <h1>${heading}</h1>
  <p>${detail}</p>
</main>
</body>
</html>`
}
