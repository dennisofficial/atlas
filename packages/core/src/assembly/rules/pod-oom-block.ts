import { systemNotice } from '../../context/envelope'
import type { EventOfType } from '../../events/envelope'
import { EOomScope, ONLY_OPERATOR_RAISES_MEMORY, podOomLine } from '../../pod/pod-oom'

export const podOomBlock = (event: EventOfType<'pod-ran-out-of-memory'>): string | undefined => {
  if (event.scope !== EOomScope.Pod) return undefined

  return systemNotice({
    kind: 'pod-oom',
    content: [podOomLine(event), ONLY_OPERATOR_RAISES_MEMORY].join('\n\n'),
  })
}
