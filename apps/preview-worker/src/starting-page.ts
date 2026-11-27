export const STARTING_PAGE_RELOAD_SECONDS = 3

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${STARTING_PAGE_RELOAD_SECONDS}">
<title>The preview is starting</title>
<style>body{font:15px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#333;text-align:center}p{margin:0;color:#666}</style>
</head>
<body>
<main>
<p>The preview is starting. This page reloads itself.</p>
</main>
</body>
</html>`

export const startingPage = (): Response =>
  new Response(PAGE, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': String(STARTING_PAGE_RELOAD_SECONDS),
    },
  })
