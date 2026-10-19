import { SetMetadata } from '@nestjs/common'

export const POD_REACHABLE_KEY = 'atlas:podReachable'

export const PodReachable = () => SetMetadata(POD_REACHABLE_KEY, true)
