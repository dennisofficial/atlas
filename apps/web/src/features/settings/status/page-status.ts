import { ESettingsPage } from '../settings-nav'
import type { PageStatusInfo } from './page-status-kind'
import { PERSONAL_PAGE_STATUS } from './personal-page-status'

export { EPageStatus, type PageStatusInfo } from './page-status-kind'
export { PROJECT_SECTION_STATUS } from './project-section-status'

export const SETTINGS_PAGE_STATUS: Record<ESettingsPage, PageStatusInfo> = PERSONAL_PAGE_STATUS
