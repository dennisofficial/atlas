const INSTALL_UPSTREAM = 'https://raw.githubusercontent.com/dennisofficial/atlas'
const RELEASE_FALLBACK = 'https://github.com/dennisofficial/atlas/releases'
const INDEX_KEY = 'index.json'
const LATEST_CACHE = 'public, max-age=60'
const TAGGED_CACHE = 'public, max-age=3600'
const SMALL_CACHE = 'public, max-age=60'

const CONTENT_TYPES = {
  dmg: 'application/x-apple-diskimage',
  zip: 'application/zip',
  gz: 'application/gzip',
  yml: 'text/yaml; charset=utf-8',
  yaml: 'text/yaml; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  sha256: 'text/plain; charset=utf-8',
  sh: 'text/plain; charset=utf-8',
}

const extensionOf = (name) => {
  const parts = name.toLowerCase().split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

export const contentTypeOf = (name) =>
  CONTENT_TYPES[extensionOf(name)] ?? 'application/octet-stream'

export const cacheControlOf = ({ name, latest }) => {
  if (latest) return LATEST_CACHE
  const extension = extensionOf(name)
  if (extension === 'json' || extension === 'map' || extension === 'yml' || extension === 'yaml') {
    return SMALL_CACHE
  }
  if (extension === 'sha256') return SMALL_CACHE
  return TAGGED_CACHE
}

const text = (body, status) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })

const installScript = async (ref) => {
  const res = await fetch(`${INSTALL_UPSTREAM}/${ref}/install.sh`, {
    cf: { cacheTtl: 300, cacheEverything: true },
  })
  if (!res.ok) {
    const status = res.status === 404 ? 404 : 502
    return text(`upstream ${res.status} for ref ${ref}\n`, status)
  }
  return new Response(res.body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=60' },
  })
}

const indexOf = async (env) => {
  const object = await env.RELEASES.get(INDEX_KEY)
  if (object === null) return null
  try {
    const index = await object.json()
    return typeof index === 'object' && index !== null ? index : null
  } catch {
    return null
  }
}

const rangeHeaderOf = (object) =>
  object.range === undefined
    ? {}
    : {
        'content-range': `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`,
      }

const fromBucket = async ({ request, env, key, name, latest }) => {
  const method = request.method === 'HEAD' ? 'head' : 'get'
  const object =
    method === 'head'
      ? await env.RELEASES.head(key)
      : await env.RELEASES.get(key, { range: request.headers })

  if (object === null) return null

  const headers = new Headers({
    'content-type': contentTypeOf(name),
    'cache-control': cacheControlOf({ name, latest }),
    'accept-ranges': 'bytes',
    etag: object.httpEtag,
    ...rangeHeaderOf(object),
  })
  if (method === 'head') {
    headers.set('content-length', String(object.size))
    return new Response(null, { headers })
  }

  const status = object.range === undefined ? 200 : 206
  return new Response(object.body, { status, headers })
}

const fromGitHub = async ({ request, env, path, name, latest }) => {
  const res = await fetch(`${RELEASE_FALLBACK}/${path}`, {
    method: request.method,
    headers: { range: request.headers.get('range') ?? '' },
  })
  if (!res.ok) return null
  return new Response(res.body, {
    status: res.status,
    headers: {
      'content-type': contentTypeOf(name),
      'cache-control': cacheControlOf({ name, latest }),
      'accept-ranges': 'bytes',
    },
  })
}

const assetOf = async ({ request, env, tag, name, latest }) => {
  const key = `releases/${tag}/${name}`
  const served = await fromBucket({ request, env, key, name, latest })
  if (served !== null) return served

  const path = latest ? `latest/download/${name}` : `download/${tag}/${name}`
  const fallback = await fromGitHub({ request, env, path, name, latest })
  if (fallback !== null) return fallback

  return text(`no ${name} in ${tag}\n`, 404)
}

const latestAssetOf = async ({ request, env, name }) => {
  const index = await indexOf(env)
  if (index === null || typeof index.latest !== 'string') {
    const fallback = await fromGitHub({
      request,
      env,
      path: `latest/download/${name}`,
      name,
      latest: true,
    })
    if (fallback !== null) return fallback
    return text('the release index is missing\n', 503)
  }
  return assetOf({ request, env, tag: index.latest, name, latest: true })
}

const tagsOf = async (env) => {
  const index = await indexOf(env)
  const tags = index !== null && Array.isArray(index.tags) ? index.tags : []
  return new Response(JSON.stringify({ tags }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': LATEST_CACHE },
  })
}

const LATEST_PREFIX = '/releases/latest/download/'
const TAGGED_PREFIX = '/releases/download/'

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return text('method not allowed\n', 405)
    }

    const pathname = new URL(request.url).pathname

    if (pathname.startsWith(LATEST_PREFIX)) {
      return latestAssetOf({ request, env, name: pathname.slice(LATEST_PREFIX.length) })
    }

    if (pathname.startsWith(TAGGED_PREFIX)) {
      const rest = pathname.slice(TAGGED_PREFIX.length)
      const slash = rest.indexOf('/')
      if (slash < 1) return text('unknown release path\n', 404)
      return assetOf({
        request,
        env,
        tag: rest.slice(0, slash),
        name: rest.slice(slash + 1),
        latest: false,
      })
    }

    if (pathname === '/releases/tags') return tagsOf(env)

    const ref = pathname.replace(/\/+$/, '')
    if (ref !== '') {
      const candidate = ref.slice(1)
      if (!/^tui-v[\w.-]*$/.test(candidate)) {
        return text('unknown ref — use /, /tui-v<version> or /releases/…\n', 404)
      }
      return installScript(candidate)
    }

    return installScript('main')
  },
}
