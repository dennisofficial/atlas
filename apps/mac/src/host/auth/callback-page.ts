import { ECallbackOutcome } from './auth-service'

const page = (message: string, status: number): Response =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>Atlas</title><body style="font-family:system-ui;text-align:center;margin-top:20vh"><p>${message}</p></body>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    },
  )

export const callbackResponse = (outcome: ECallbackOutcome): Response =>
  outcome === ECallbackOutcome.SignedIn
    ? page('Signed in. You can close this tab and return to Atlas.', 200)
    : page('Sign-in could not be completed. Return to Atlas and try again.', 400)
