import { useState } from 'react'
import { Slider as SliderPrimitive } from '@base-ui/react/slider'
import { cn } from 'cn'

const SIZE = {
  default: { track: 'data-horizontal:h-1 data-vertical:w-1', thumb: 'size-3' },
  lg: { track: 'data-horizontal:h-1.5 data-vertical:w-1.5', thumb: 'size-4.5' },
}

type SliderSize = keyof typeof SIZE

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  size = 'default',
  'aria-label': ariaLabel,
  ...props
}: SliderPrimitive.Root.Props & { size?: SliderSize }) {
  const [glides, setGlides] = useState(false)
  const handleGlide = () => setGlides(true)
  const _values = Array.isArray(value)
    ? value
    : typeof value === 'number'
      ? [value]
      : Array.isArray(defaultValue)
        ? defaultValue
        : typeof defaultValue === 'number'
          ? [defaultValue]
          : [min, max]

  return (
    <SliderPrimitive.Root
      className={cn('data-horizontal:w-full data-vertical:h-full', className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control
        className="relative flex w-full touch-none cursor-pointer items-center select-none after:absolute after:inset-x-0 after:-inset-y-2 data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col data-vertical:after:inset-y-0 data-vertical:after:-inset-x-2"
        onPointerDownCapture={handleGlide}
        onKeyDownCapture={handleGlide}
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn(
            'relative grow overflow-hidden rounded-full bg-muted select-none data-horizontal:w-full data-vertical:h-full',
            SIZE[size].track,
          )}
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className={cn(
              'bg-primary select-none data-horizontal:h-full data-vertical:w-full',
              glides && 'transition-[width] duration-200 ease-out',
            )}
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            {...(ariaLabel === undefined ? {} : { getAriaLabel: () => ariaLabel })}
            className={cn(
              'relative block cursor-pointer shrink-0 rounded-full border border-ring bg-white ring-ring/50 select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50',
              glides
                ? 'transition-[inset-inline-start,color,box-shadow] duration-200 ease-out'
                : 'transition-[color,box-shadow]',
              SIZE[size].thumb,
            )}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider, type SliderSize }
