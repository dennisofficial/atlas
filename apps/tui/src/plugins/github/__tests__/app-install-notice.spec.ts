import { afterEach, describe, expect, it } from 'bun:test'

import { currentNotices, dismissNotice } from '../../../ui/notice-store'
import {
  appInstallNoticeKey,
  appInstallNoticeText,
  createAppInstallNoticer,
} from '../app-install-notice'

const REPO = 'acme/widgets'
const INSTALL_URL = 'https://github.com/apps/atlas-by-dl/installations/new'

const standing = () => currentNotices().filter((notice) => notice.key === appInstallNoticeKey(REPO))

describe('createAppInstallNoticer', () => {
  afterEach(() => dismissNotice())

  it('raises the install recommendation with the repo and the install url', () => {
    createAppInstallNoticer().raise({ repo: REPO, installUrl: INSTALL_URL })

    expect(standing().map((notice) => notice.text)).toEqual([
      appInstallNoticeText({ repo: REPO, installUrl: INSTALL_URL }),
    ])
    expect(standing()[0]?.text).toContain('polled (degraded)')
    expect(standing()[0]?.text).toContain(INSTALL_URL)
  })

  it('raises once per repo for the life of the session, even after the notice is cleared', () => {
    const noticer = createAppInstallNoticer()
    noticer.raise({ repo: REPO, installUrl: INSTALL_URL })
    dismissNotice()
    noticer.raise({ repo: REPO, installUrl: INSTALL_URL })

    expect(standing()).toEqual([])
  })

  it('raises separately for another repo', () => {
    const noticer = createAppInstallNoticer()
    noticer.raise({ repo: REPO, installUrl: INSTALL_URL })
    noticer.raise({ repo: 'acme/other', installUrl: INSTALL_URL })

    expect(currentNotices().map((notice) => notice.key)).toEqual([
      appInstallNoticeKey(REPO),
      appInstallNoticeKey('acme/other'),
    ])
  })

  it('dismisses the standing notice, records the dismissal, and does not re-raise', () => {
    const recorded: string[] = []
    const noticer = createAppInstallNoticer({ recordDismissal: ({ repo }) => recorded.push(repo) })
    noticer.raise({ repo: REPO, installUrl: INSTALL_URL })
    noticer.dismiss({ repo: REPO })
    noticer.raise({ repo: REPO, installUrl: INSTALL_URL })

    expect(standing()).toEqual([])
    expect(recorded).toEqual([REPO])
  })
})
