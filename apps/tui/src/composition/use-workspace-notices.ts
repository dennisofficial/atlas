import { useEffect, useRef } from 'react'

import { unmeasuredWindowWarning } from '@dltech/atlas-harness'

import { hasLostChildren, lostChildrenNotice } from '../ui/lost-children-model'
import { hasLostShells, lostShellsNotice } from '../ui/lost-shells-model'
import {
  clearNotice,
  configureNotices,
  ENoticeTone,
  NOTICE_KEY_CLASSIFIER_OFFLINE,
  NOTICE_KEY_LOST_AGENTS,
  NOTICE_KEY_LOST_SHELLS,
  NOTICE_WARN_MS,
  notify,
} from '../ui/notice-store'
import type { AtlasApp } from './compose'
import type { useConversation } from './use-conversation'

const CLOUD_SIGN_IN_OFFER_MS = 20_000

export function useWorkspaceNotices(args: {
  app: AtlasApp
  conversation: ReturnType<typeof useConversation>
  noticeSeconds: number
}): void {
  const { app, conversation, noticeSeconds } = args
  const { lost, lostShells } = conversation
  const judgeFault = conversation.sidebar.classifier?.judgeUnreachable ?? null

  useEffect(() => {
    const warning = unmeasuredWindowWarning({
      catalogue: app.models,
      ref: app.model.choice().ref,
    })
    if (warning === null) return

    notify({
      key: 'context-window-unmeasured',
      text: warning,
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
    })
  }, [app.model, app.models])

  useEffect(() => {
    if (!hasLostChildren(lost)) {
      clearNotice({ key: NOTICE_KEY_LOST_AGENTS })
      return
    }

    notify({
      key: NOTICE_KEY_LOST_AGENTS,
      text: lostChildrenNotice(lost),
      tone: ENoticeTone.Warn,
      sticky: true,
    })
  }, [lost])

  useEffect(() => {
    if (!hasLostShells(lostShells)) {
      clearNotice({ key: NOTICE_KEY_LOST_SHELLS })
      return
    }

    notify({
      key: NOTICE_KEY_LOST_SHELLS,
      text: lostShellsNotice(lostShells),
      tone: ENoticeTone.Warn,
      sticky: true,
    })
  }, [lostShells])

  useEffect(() => {
    if (judgeFault === null) {
      clearNotice({ key: NOTICE_KEY_CLASSIFIER_OFFLINE })
      return
    }

    notify({
      key: NOTICE_KEY_CLASSIFIER_OFFLINE,
      text:
        judgeFault === ''
          ? 'nudge offline — the classifier could not be reached'
          : `nudge offline — the judge could not be reached: ${judgeFault}`,
      tone: ENoticeTone.Warn,
      sticky: true,
    })
  }, [judgeFault])

  useEffect(() => {
    configureNotices({ ttlMs: noticeSeconds * 1000 })
  }, [noticeSeconds])

  const cloudSignInNoticed = useRef(false)
  useEffect(() => {
    if (cloudSignInNoticed.current) return
    cloudSignInNoticed.current = true
    if (app.cloud.session() !== null) return
    if (app.cloud.signInOffered()) return

    app.cloud.markSignInOffered()
    notify({
      key: 'cloud-sign-in-offer',
      text: 'sign in to Atlas Cloud to register cloud sandboxes for remote control and discovery — settings (ctrl+o) › cloud',
      tone: ENoticeTone.Info,
      ttlMs: CLOUD_SIGN_IN_OFFER_MS,
    })
  }, [app.cloud])
}
