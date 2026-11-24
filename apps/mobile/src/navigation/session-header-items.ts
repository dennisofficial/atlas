import { EThreadsLayout, type TPosture } from '../layout/posture'

export enum ESessionHeaderItem {
  Threads = 'threads',
}

export const sessionHeaderItemsOf = ({ posture }: { posture: TPosture }): ESessionHeaderItem[] =>
  posture.threads === EThreadsLayout.Overlay ? [ESessionHeaderItem.Threads] : []
