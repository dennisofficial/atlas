const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)

export function deploymentNotFoundHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 — Not Found</title>
<style>
  :root { color-scheme: light dark }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #1a1a1a; background: #fafafa;
  }
  main { max-width: 32rem; padding: 2rem; text-align: center }
  h1 { margin: 0 0 .5rem; font-size: 1.125rem; font-weight: 600; letter-spacing: -.01em }
  p { margin: 0; color: #6b6b6b; font-size: .9375rem }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .875em }
  @media (prefers-color-scheme: dark) {
    body { color: #ededed; background: #111 }
    p { color: #9a9a9a }
  }
</style>
</head>
<body>
<main>
  <h1>Not Found</h1>
  <p>This path does not exist on this deployment.</p>
</main>
</body>
</html>
`
}

export function artifactNotFoundHtml({ host }: { host: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Artifact not found — Atlas</title>
<style>
  :root { color-scheme: light dark }
  * { box-sizing: border-box }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #0a0a0a; background:
      radial-gradient(60rem 40rem at 50% -10%, rgba(99,102,241,.10), transparent 70%),
      #ffffff;
  }
  main { width: 100%; max-width: 30rem; padding: 2rem 1.5rem 3rem }
  .mark {
    display: inline-flex; align-items: center; gap: .5rem; margin-bottom: 1.75rem;
    font-size: .8125rem; font-weight: 500; letter-spacing: .02em; color: #52525b;
  }
  .dot { width: .5rem; height: .5rem; border-radius: 999px; background: #6366f1 }
  h1 { margin: 0 0 .625rem; font-size: 1.375rem; font-weight: 600; letter-spacing: -.02em }
  p { margin: 0 0 1.5rem; color: #52525b; font-size: .9375rem }
  code {
    display: block; width: 100%; overflow-wrap: anywhere;
    padding: .75rem .875rem; border: 1px solid #e4e4e7; border-radius: .5rem;
    background: #fafafa; color: #3f3f46;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8125rem;
  }
  a { color: #4f46e5; text-decoration: none; font-size: .9375rem; font-weight: 500 }
  a:hover { text-decoration: underline }
  @media (prefers-color-scheme: dark) {
    body {
      color: #fafafa; background:
        radial-gradient(60rem 40rem at 50% -10%, rgba(129,140,248,.12), transparent 70%),
        #0a0a0a;
    }
    .mark, p { color: #a1a1aa }
    code { border-color: #27272a; background: #18181b; color: #d4d4d8 }
    a { color: #a5b4fc }
  }
</style>
</head>
<body>
<main>
  <div class="mark"><span class="dot"></span>Atlas</div>
  <h1>Artifact not found</h1>
  <p>No artifact is published at this address. It may have been unpublished, or the link may be wrong.</p>
  <code>${escapeHtml(host)}</code>
  <p style="margin-top:1.5rem"><a href="https://byatlas.io">Go to Atlas</a></p>
</main>
</body>
</html>
`
}
