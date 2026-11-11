export { artifactNotFoundHtml } from './atlas-not-found'

export function deploymentNotFoundHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
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
  @media (prefers-color-scheme: dark) {
    body { color: #ededed; background: #111 }
    p { color: #9a9a9a }
  }
</style>
</head>
<body>
<main>
  <h1>Not Found</h1>
  <p>This path does not exist on this artifact.</p>
</main>
</body>
</html>
`
}
