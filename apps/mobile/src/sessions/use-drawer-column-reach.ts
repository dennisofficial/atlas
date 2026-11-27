import { sideColumnInsetOf } from '../layout/posture'
import { useWindowInsets } from '../layout/side-inset-frame'
import { usePosture } from '../layout/use-posture'
import { drawerColumnReachOf } from './drawer-layout'

export const useDrawerColumnReach = (): number => {
  const posture = usePosture()
  const columnInset = sideColumnInsetOf(useWindowInsets())
  return drawerColumnReachOf({ listLayout: posture.sessionsList, columnInset })
}
