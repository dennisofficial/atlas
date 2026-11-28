'use client'

import {
  createProviderSignIn,
  EBrowserSignInResult,
  type ProviderSignInControl,
} from '@dltech/atlas-client/settings'
import type { EOauthProvider } from '@dltech/atlas-wire/web'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { isDesktopHost } from '@/features/desktop/desktop-attributes'
import { EDesktopProviderResult, signInThroughDesktop } from './desktop-provider-sign-in'
import { errorMessageOf } from './error-message'
import {
  beginProviderSignIn,
  completeProviderSignIn,
  pollProviderSignIn,
} from './provider-sign-in-api'

export {
  EProviderSignInState,
  type ProviderSignInFlow,
  type ProviderSignInControl,
} from '@dltech/atlas-client/settings'

export function useProviderSignIn(args: {
  provider: EOauthProvider
  onChanged: () => void
}): ProviderSignInControl {
  const changed = useRef(args.onChanged)
  changed.current = args.onChanged
  const controller = useMemo(
    () =>
      createProviderSignIn({
        provider: args.provider,
        browser:
          typeof window !== 'undefined' && isDesktopHost(window)
            ? async (browserArgs) => {
                const result = await signInThroughDesktop({
                  provider: args.provider,
                  ...browserArgs,
                })
                switch (result) {
                  case EDesktopProviderResult.SignedIn:
                    return EBrowserSignInResult.SignedIn
                  case EDesktopProviderResult.Cancelled:
                    return EBrowserSignInResult.Cancelled
                  case EDesktopProviderResult.Fallback:
                    return EBrowserSignInResult.Fallback
                }
              }
            : undefined,
        begin: beginProviderSignIn,
        complete: completeProviderSignIn,
        poll: pollProviderSignIn,
        open: (url) => {
          window.open(url, '_blank', 'noopener')
        },
        errorMessage: errorMessageOf,
        onChanged: () => changed.current(),
        now: Date.now,
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }),
    [args.provider],
  )
  useEffect(() => () => controller.cancel(), [controller])
  const flow = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  return {
    flow,
    start: controller.start,
    cancel: controller.cancel,
    submitCode: controller.submitCode,
  }
}
