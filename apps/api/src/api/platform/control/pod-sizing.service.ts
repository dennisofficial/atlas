import { Inject, Injectable } from '@nestjs/common'
import type { ControlCommandHandler } from '@dltech/atlas-commands'
import { ControlPlane } from '@dltech/atlas-control'

import { JobsProjectDispatcher } from '../../../_core/ports/job-dispatcher'
import { podResizeCancelHandlerOf } from '../../../_lib/pod-resize/pod-resize-cancel-handler'
import { podResizeHandlerOf } from '../../../_lib/pod-resize/pod-resize-handler'

export type PodSizing = {
  resizeHandler(): ControlCommandHandler<ControlPlane, unknown>
  cancelHandler(): ControlCommandHandler<ControlPlane, unknown>
}

@Injectable()
export class PodSizingService implements PodSizing {
  constructor(
    @Inject(ControlPlane) private readonly plane: ControlPlane,
    @Inject(JobsProjectDispatcher) private readonly dispatcher: JobsProjectDispatcher,
  ) {}

  resizeHandler(): ControlCommandHandler<ControlPlane, unknown> {
    return podResizeHandlerOf({ plane: this.plane, dispatcher: this.dispatcher })
  }

  cancelHandler(): ControlCommandHandler<ControlPlane, unknown> {
    return podResizeCancelHandlerOf({ plane: this.plane })
  }
}
