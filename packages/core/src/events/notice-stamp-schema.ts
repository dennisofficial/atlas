import { z } from 'zod'

import { ENoticeStage } from './notice-stage'

export const noticeStampSchema = z.object({ id: z.string().min(1), stage: z.enum(ENoticeStage) })
