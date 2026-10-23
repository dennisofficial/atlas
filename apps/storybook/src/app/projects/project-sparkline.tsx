import { Area, AreaChart, YAxis } from 'recharts'

import { ChartContainer, type ChartConfig } from '@dltech/atlas-ui/components/chart'

const CONFIG: ChartConfig = {
  activity: { label: 'Activity', color: 'var(--success)' },
}

export function ProjectSparkline({ series, label }: { series: number[]; label: string }) {
  const data = series.map((value, index) => ({ index, value }))
  return (
    <ChartContainer
      config={CONFIG}
      className="aspect-auto h-8 w-[100px] shrink-0 justify-end"
      initialDimension={{ width: 100, height: 32 }}
      role="img"
      aria-label={label}
    >
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <YAxis hide domain={[0, 'dataMax']} />
        <Area
          dataKey="value"
          type="monotone"
          stroke="var(--color-activity)"
          strokeWidth={1.5}
          fill="var(--color-activity)"
          fillOpacity={0.18}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}
