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
<title>Signed in</title>
<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#222;text-align:center}h1{font-size:20px;font-weight:600;margin:0 0 6px}p{margin:0;color:#666}a{display:inline-block;margin-top:16px;color:#666;font-size:14px}</style>
</head>
<body>
<main>
<h1>Signed in</h1>
<p>You can close this tab.</p>
<a href="${escapeHtml(link)}">Atlas didn't open? Return to Atlas</a>
</main>
<script>window.location.href = ${scriptString(link)}; setTimeout(function () { window.close() }, 500)</script>
</body>
</html>`
}
