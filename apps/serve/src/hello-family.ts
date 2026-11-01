import type { ThreadId } from '@dltech/atlas-core'

import type { HelloFrame, SessionSocket, SessionHandlersArgs } from './socket-session-types'

type GreetRest = (given: { socket: SessionSocket; hello: HelloFrame; head: number | null }) => void

type TranscriptHead = NonNullable<SessionHandlersArgs['transcript']>

export type HelloAdmissionArgs = {
  threadId: ThreadId
  admitsThread?: ((threadId: string) => Promise<boolean>) | undefined
  transcript?: TranscriptHead | undefined
  live: Set<SessionSocket>
  greetRest: GreetRest
  refuse: (given: { socket: SessionSocket; reason: string }) => void
}

/**
 * The Hello path: a family thread's transcript head is read before greeting so the client learns
 * whether its durable log is current; admission of a non-root thread goes through the session
 * family's admitsThread and fails closed.
 */
export function createHelloAdmission(args: HelloAdmissionArgs) {
  const { threadId, admitsThread, transcript, live, greetRest, refuse } = args

  const greet = (given: { socket: SessionSocket; hello: HelloFrame }): void => {
    const { socket, hello } = given
    if (transcript === undefined) {
      greetRest({ socket, hello, head: null })
      return
    }
    void transcript.log.head({ threadId: hello.threadId }).then(
      (head) => {
        if (!live.has(socket)) return
        greetRest({ socket, hello, head })
      },
      () => {
        if (!live.has(socket)) return
        greetRest({ socket, hello, head: null })
      },
    )
  }

  const admitHello = (given: { socket: SessionSocket; hello: HelloFrame }): void => {
    const { socket, hello } = given
    if (hello.threadId === threadId) {
      greet({ socket, hello })
      return
    }
    if (admitsThread === undefined) {
      refuse({ socket, reason: 'this sandbox serves one thread' })
      return
    }
    void admitsThread(hello.threadId)
      .then((admittedFamily) => {
        if (!live.has(socket)) return
        if (!admittedFamily) {
          refuse({ socket, reason: 'this sandbox serves one thread' })
          return
        }
        greet({ socket, hello })
      })
      .catch(() => {
        if (!live.has(socket)) return
        refuse({ socket, reason: 'this sandbox serves one thread' })
      })
  }

  return { admitHello }
}
