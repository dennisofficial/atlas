export const APNS_TOKEN_PATH = '/desktop/apns/token'

export const APNS_PUSH_PATH = '/desktop/apns/push'

export const SESSION_PATH = '/sessions/'

const POST_TIMEOUT_MS = 2_000

const recordOf = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined

export const sessionIdOfLaunchInfo = (launchInfo) => {
  const info = recordOf(launchInfo)
  if (info === undefined) return undefined
  const userInfo = recordOf(info.userInfo) ?? info
  if (typeof userInfo.clearSessionId === 'string') return undefined
  const { sessionId, seq } = userInfo
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
  return Number.isInteger(seq) ? sessionId : undefined
}

export const urlForSession = (origin, sessionId) =>
  sessionId === undefined ? origin : `${origin}${SESSION_PATH}${encodeURIComponent(sessionId)}`

export function createApnsBridge({
  secret,
  fetchFn = fetch,
  notifications,
  pushes,
  log = () => {},
}) {
  let token
  let origin

  const post = async (pathname, body) => {
    if (origin === undefined) return undefined
    const reply = await fetchFn(`${origin}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `atlas_desktop=${secret}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    })
    return reply.ok ? await reply.json() : undefined
  }

  const sendToken = async () => {
    if (token === undefined || origin === undefined) return
    await post(APNS_TOKEN_PATH, { token }).catch(() => undefined)
  }

  const historyGroupsOf = async () => {
    try {
      const history = await notifications.getHistory()
      return history.flatMap((entry) => (entry.groupId ? [entry.groupId] : []))
    } catch {
      return []
    }
  }

  const groupsOf = async (userInfo) => {
    const reply = await post(APNS_PUSH_PATH, {
      userInfo,
      groupIds: await historyGroupsOf(),
    }).catch(() => undefined)
    return Array.isArray(reply?.groups) ? reply.groups : []
  }

  const received = async (userInfo) => {
    for (const groupId of await groupsOf(userInfo)) notifications.removeGroup(groupId)
  }

  return {
    attach: (url) => {
      origin = url
      void sendToken()
    },
    received,
    start: async () => {
      pushes.on('received-apns-notification', (_event, userInfo) => {
        void received(userInfo)
      })
      try {
        token = await pushes.registerForAPNSNotifications()
      } catch (error) {
        log(`[apns] registration failed: ${error}`)
        return
      }
      await sendToken()
    },
  }
}
