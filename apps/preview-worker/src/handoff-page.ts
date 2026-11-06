const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

const scriptString = (value: string): string => JSON.stringify(value).replaceAll('<', '\\u003c')

export function handoffPage(link: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Return to Atlas</title>
<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#222}a{display:inline-block;margin-top:12px;padding:10px 18px;border-radius:8px;background:#222;color:#fff;text-decoration:none}</style>
</head>
<body>
<main>
<p>Signed in. Finishing in the Atlas app.</p>
<a href="${escapeHtml(link)}">Return to Atlas</a>
</main>
<script>window.location.href = ${scriptString(link)}</script>
</body>
</html>`
}
