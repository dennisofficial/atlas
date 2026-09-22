const UPSTREAM = 'https://raw.githubusercontent.com/dennisofficial/atlas'

export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405 })
    }

    let ref = 'main'
    const path = new URL(request.url).pathname.replace(/\/+$/, '')
    if (path !== '') {
      ref = path.slice(1)
      if (!/^tui-v[\w.-]*$/.test(ref)) {
        return new Response('unknown ref — use / or /tui-v<version>\n', { status: 404 })
      }
    }

    const res = await fetch(`${UPSTREAM}/${ref}/install.sh`, {
      cf: { cacheTtl: 300, cacheEverything: true },
    })
    if (!res.ok) {
      const status = res.status === 404 ? 404 : 502
      return new Response(`upstream ${res.status} for ref ${ref}\n`, { status })
    }

    return new Response(res.body, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=60',
      },
    })
  },
}
