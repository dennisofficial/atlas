export const API = process.env.E2E_API_URL ?? 'http://localhost:3401'
export const PG_CONTAINER = process.env.E2E_PG_CONTAINER ?? 'atlas-e2e-cloud-pg'
export const SERVE_PORT = Number(process.env.E2E_SERVE_PORT ?? 3402)
export const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 3403)

export const fail = (reason) => {
  console.error(`FAIL: ${reason}`)
  process.exit(1)
}

export const log = (line) => console.log(line)

export const signUp = async () => {
  const res = await fetch(`${API}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@rig.local`,
      password: 'e2e-rig-password-long-enough',
      name: 'Rig',
    }),
  })
  if (res.status !== 200) fail(`sign-up answered ${res.status}`)
  const body = await res.json()
  return { token: body.token, userId: body.user.id }
}

export const userSaid = (text) => ({
  type: 'user-said',
  body: JSON.stringify({ type: 'user-said', text }),
})
