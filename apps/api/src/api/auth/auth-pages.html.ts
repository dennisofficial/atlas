const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Atlas — ${title}</title>
<style>
  body { font-family: ui-monospace, monospace; background: #0d1117; color: #e6edf3; display: flex; justify-content: center; padding: 4rem 1rem; }
  main { width: 100%; max-width: 22rem; }
  h1 { font-size: 1.1rem; font-weight: 600; }
  input, button { width: 100%; box-sizing: border-box; padding: 0.6rem; margin-top: 0.75rem; border-radius: 6px; border: 1px solid #30363d; background: #161b22; color: inherit; font: inherit; }
  button { background: #238636; border: none; cursor: pointer; }
  button.deny { background: #da3633; }
  a { color: #58a6ff; }
  .error { color: #f85149; margin-top: 0.75rem; }
  .code { font-size: 1.6rem; letter-spacing: 0.2em; text-align: center; margin: 1rem 0; }
  .muted { color: #8b949e; font-size: 0.85rem; margin-top: 1rem; }
</style>
</head>
<body><main><h1>${title}</h1>${body}</main></body>
</html>`

export const SIGN_UP_PAGE = page(
  'Create your Atlas account',
  `<form id="form">
    <input name="name" placeholder="Name" required autocomplete="name" />
    <input name="email" type="email" placeholder="Email" required autocomplete="email" />
    <input name="password" type="password" placeholder="Password (min 8 chars)" required minlength="8" autocomplete="new-password" />
    <button type="submit">Sign up</button>
  </form>
  <p class="muted">Already have an account? <a href="/sign-in">Sign in</a></p>
  <p class="error" id="error"></p>
  <script>
    document.getElementById('form').addEventListener('submit', async (event) => {
      event.preventDefault()
      const form = new FormData(event.target)
      try {
        const response = await fetch('/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: form.get('name'),
            email: form.get('email'),
            password: form.get('password'),
          }),
        })
        if (response.ok) {
          window.location.href = new URLSearchParams(window.location.search).get('next') ?? '/device'
        } else {
          const body = await response.json().catch(() => ({}))
          document.getElementById('error').textContent = body.message ?? 'Sign-up failed'
        }
      } catch {
        document.getElementById('error').textContent = 'Could not reach Atlas Cloud — check your connection and retry.'
      }
    })
  </script>`,
)

export const SIGN_IN_PAGE = page(
  'Sign in to Atlas',
  `<form id="form">
    <input name="email" type="email" placeholder="Email" required autocomplete="email" />
    <input name="password" type="password" placeholder="Password" required autocomplete="current-password" />
    <button type="submit">Sign in</button>
  </form>
  <p class="muted">No account yet? <a href="/sign-up">Sign up</a></p>
  <p class="error" id="error"></p>
  <script>
    document.getElementById('form').addEventListener('submit', async (event) => {
      event.preventDefault()
      const form = new FormData(event.target)
      try {
        const response = await fetch('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
        })
        if (response.ok) {
          window.location.href = new URLSearchParams(window.location.search).get('next') ?? '/device'
        } else {
          document.getElementById('error').textContent = 'Invalid email or password'
        }
      } catch {
        document.getElementById('error').textContent = 'Could not reach Atlas Cloud — check your connection and retry.'
      }
    })
  </script>`,
)

export const DEVICE_PAGE = page(
  'Authorize a device',
  `<div id="loading">Loading…</div>
  <div id="content" hidden>
    <p class="muted">A device is asking to sign in to your Atlas account. Confirm the code matches what the device shows.</p>
    <p class="code" id="code"></p>
    <button id="approve">Approve</button>
    <button class="deny" id="deny">Deny</button>
  </div>
  <p class="error" id="error"></p>
  <script>
    const userCode = (new URLSearchParams(window.location.search).get('user_code') ?? '')
      .trim().replace(/-/g, '').toUpperCase()
    const show = (text) => { document.getElementById('error').textContent = text }

    async function act(action) {
      const response = await fetch('/api/auth/device/' + action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userCode }),
      })
      const target = document.getElementById('content')
      if (response.ok) {
        target.innerHTML = '<p>' + (action === 'approve'
          ? 'Device authorized — you can return to your terminal.'
          : 'Device denied.') + '</p>'
      } else {
        const body = await response.json().catch(() => ({}))
        show(body.message ?? 'Request failed')
      }
    }

    fetch('/api/auth/get-session')
      .then(async (response) => {
        document.getElementById('loading').hidden = true
        const session = await response.json().catch(() => null)
        if (!response.ok || !session || !session.user) {
          window.location.href = '/sign-in?next=' + encodeURIComponent('/device?user_code=' + userCode)
          return
        }
        const claim = await fetch('/api/auth/device?user_code=' + encodeURIComponent(userCode), {
          headers: { accept: 'application/json' },
        })
        if (!claim.ok) {
          const body = await claim.json().catch(() => ({}))
          show(body.message ?? body.error_description ?? 'Unknown or expired device code')
          return
        }
        document.getElementById('code').textContent = userCode
        document.getElementById('content').hidden = false
        document.getElementById('approve').addEventListener('click', () => act('approve'))
        document.getElementById('deny').addEventListener('click', () => act('deny'))
      })
      .catch(() => {
        document.getElementById('loading').hidden = true
        show('Could not reach Atlas Cloud — check your connection and reload this page.')
      })
  </script>`,
)
