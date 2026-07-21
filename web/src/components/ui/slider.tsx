import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  thumbLabels,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & { thumbLabels?: string[] }) {
  const values = React.useMemo(
    () => Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max],
    [defaultValue, max, min, value],
  )

  return <SliderPrimitive.Root
    data-slot="slider"
    defaultValue={defaultValue}
    value={value}
    min={min}
    max={max}
    className={cn("relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50", className)}
    {...props}
  >
    <SliderPrimitive.Track data-slot="slider-track" className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
      <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    {values.map((_, index) => <SliderPrimitive.Thumb
      key={index}
      data-slot="slider-thumb"
      aria-label={thumbLabels?.[index]}
      className="block size-3.5 cursor-grab rounded-full border-2 border-primary bg-background shadow-sm outline-none ring-ring/50 transition-[box-shadow,transform] hover:scale-110 focus-visible:ring-[3px] active:cursor-grabbing disabled:pointer-events-none disabled:opacity-50"
    />)}
  </SliderPrimitive.Root>
}

export { Slider }
