import { ECallbackOutcome } from './auth-service'

export const APP_FOCUS_LINK = 'atlas://focus'

const page = (args: { message: string; status: number; reopen: boolean }): Response => {
  const handoff = args.reopen
    ? `<p><a href="${APP_FOCUS_LINK}">Open Atlas</a></p><script>window.location.href = ${JSON.stringify(APP_FOCUS_LINK)}</script>`
    : ''
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Atlas</title><body style="font-family:system-ui;text-align:center;margin-top:20vh"><p>${args.message}</p>${handoff}</body>`,
    {
      status: args.status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    },
  )
}

export const callbackResponse = (outcome: ECallbackOutcome): Response =>
  outcome === ECallbackOutcome.SignedIn
    ? page({
        message: 'Signed in. You can close this tab and return to Atlas.',
        status: 200,
        reopen: true,
      })
    : page({
        message: 'Sign-in could not be completed. Return to Atlas and try again.',
        status: 400,
        reopen: false,
      })
