const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)

const ATLAS_MARK = `<svg class="mark" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><path d="M88 372 245 132q10-14 20 0l66 104-48 31-28-43-103 156q-4 5-12 5H96q-14 0-8-13Z"/><path d="M345 247 415 366q7 19-10 19h-43q-8 0-12-7l-60-98Z"/></svg>`

export function artifactNotFoundHtml({ host }: { host: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Artifact not found — Atlas</title>
<style>
  :root {
    color-scheme: dark;
    --background: #282422;
    --foreground: #f0e9e3;
    --card: #1e1a17;
    --muted: #2b2724;
    --muted-foreground: #8a8078;
    --border: #3a3532;
    --primary: #d97757;
    --link: #7cbdff;
    --radius: 0.625rem;
    --font-display: "Space Grotesk", "Futura", "Avenir Next", system-ui, sans-serif;
    --font-sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: light) {
    :root {
      color-scheme: light;
      --background: #f5f1ec;
      --foreground: #2a2522;
      --card: #fbf9f6;
      --muted: #eae3db;
      --muted-foreground: #6b625c;
      --border: #ddd4ca;
      --primary: #a44d31;
      --link: #28558f;
    }
  }
  * { box-sizing: border-box }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    padding: 1.5rem; background: var(--background); color: var(--foreground);
    font-family: var(--font-sans); font-size: 16px; line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    width: 100%; max-width: 30rem; padding: 2rem;
    background: var(--card); border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 1px 2px rgba(0, 0, 0, .18), 0 12px 32px -12px rgba(0, 0, 0, .45);
  }
  .brand {
    display: flex; align-items: center; gap: .5rem; margin-bottom: 1.5rem;
    font-family: var(--font-display); font-size: 1.0625rem; font-weight: 600;
    letter-spacing: -.01em;
  }
  .mark { width: 1.125rem; height: 1.125rem; color: var(--primary); flex: none }
  h1 {
    margin: 0 0 .5rem; font-family: var(--font-display);
    font-size: 1.25rem; font-weight: 600; letter-spacing: -.02em; line-height: 1.3;
  }
  p { margin: 0; color: var(--muted-foreground); font-size: .9375rem }
  code {
    display: block; margin: 1.25rem 0 0; padding: .625rem .75rem;
    background: var(--muted); border: 1px solid var(--border);
    border-radius: calc(var(--radius) - .25rem);
    font-family: var(--font-mono); font-size: .8125rem; color: var(--foreground);
    overflow-wrap: anywhere;
  }
  .actions { margin-top: 1.5rem }
  a { color: var(--link); text-decoration: none; font-size: .9375rem; font-weight: 500 }
  a:hover { text-decoration: underline; text-underline-offset: 2px }
</style>
</head>
<body>
<main class="card">
  <div class="brand">${ATLAS_MARK}<span>Atlas</span></div>
  <h1>Artifact not found</h1>
  <p>No artifact is published at this address. It may have been unpublished, or the link may be wrong.</p>
  <code>${escapeHtml(host)}</code>
  <div class="actions"><a href="https://byatlas.io">Go to Atlas</a></div>
</main>
</body>
</html>
`
}
