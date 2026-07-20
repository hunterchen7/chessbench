import * as React from "react"

import { cn } from "@/lib/utils"
import { orderAfterColumnDrop, usePersistentColumnOrder, type ColumnDropSide } from "@/lib/usePersistentColumnOrder"

interface ColumnOrderContextValue {
  columnCount: number
  order: string[]
  move: (source: string, target: string) => void
  dragSource: string | null
  dropTarget: string | null
  dropSide: ColumnDropSide | null
  startDrag: (source: string) => void
  hoverDrop: (target: string, side: ColumnDropSide) => void
  commitDrop: () => void
  endDrag: () => void
}

const ColumnOrderContext = React.createContext<ColumnOrderContextValue | null>(null)
const COLUMN_DRAG_TYPE = "application/x-chessbench-table-column"

function headerColumnCount(children: React.ReactNode): number {
  let count = 0
  function visit(node: React.ReactNode, inHeader = false) {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement<{ children?: React.ReactNode }>(child) || count) return
      const childInHeader = inHeader || child.type === TableHeader
      if (childInHeader && child.type === TableRow) {
        count = React.Children.count(child.props.children)
        return
      }
      visit(child.props.children, childInHeader)
    })
  }
  visit(children)
  return count
}

function Table({ className, reorderableKey, children, ...props }: React.ComponentProps<"table"> & { reorderableKey?: string }) {
  const columnCount = headerColumnCount(children)
  const { order, move, drop } = usePersistentColumnOrder(reorderableKey, columnCount)
  const [dragState, setDragState] = React.useState<{ source: string; target: string | null; side: ColumnDropSide | null } | null>(null)
  const endDrag = React.useCallback(() => setDragState(null), [])
  const commitDrop = React.useCallback(() => {
    if (dragState?.target && dragState.side) drop(dragState.source, dragState.target, dragState.side)
    setDragState(null)
  }, [dragState, drop])

  const context = React.useMemo<ColumnOrderContextValue | null>(() => reorderableKey && columnCount > 1 ? {
    columnCount,
    order,
    move,
    dragSource: dragState?.source ?? null,
    dropTarget: dragState?.target ?? null,
    dropSide: dragState?.side ?? null,
    startDrag: (source) => setDragState({ source, target: null, side: null }),
    hoverDrop: (target, side) => setDragState((current) => !current ? current : current.source === target ? { ...current, target: null, side: null } : { ...current, target, side }),
    commitDrop,
    endDrag,
  } : null, [columnCount, commitDrop, dragState, endDrag, move, order, reorderableKey])

  return (
    <ColumnOrderContext.Provider value={context}>
      <div
        data-slot="table-container"
        className="relative w-full overflow-x-auto"
      >
        <table
          data-slot="table"
          className={cn("w-full caption-bottom text-sm", className)}
          {...props}
        >{children}</table>
      </div>
    </ColumnOrderContext.Provider>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, children, ...props }: React.ComponentProps<"tr">) {
  const context = React.useContext(ColumnOrderContext)
  const cells = React.Children.toArray(children)
  const orderedChildren = context && cells.length === context.columnCount
    ? context.order.map((key) => {
        const index = Number(key)
        const child = cells[index]
        return React.isValidElement(child) ? React.cloneElement(child, { columnKey: key } as { columnKey: string }) : child
      })
    : children
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    >{orderedChildren}</tr>
  )
}

function columnDragVisual(context: ColumnOrderContextValue | null, columnKey?: string) {
  if (!context || columnKey == null || !context.dragSource) return {}
  const preview = context.dropTarget && context.dropSide
    ? orderAfterColumnDrop(context.order, context.dragSource, context.dropTarget, context.dropSide)
    : context.order
  const currentIndex = context.order.indexOf(columnKey)
  const previewIndex = preview.indexOf(columnKey)
  return {
    dragging: columnKey === context.dragSource,
    dropSide: columnKey === context.dropTarget ? context.dropSide ?? undefined : undefined,
    shift: columnKey === context.dragSource || currentIndex === previewIndex ? undefined : previewIndex < currentIndex ? "left" : "right",
  }
}

function TableHead({ className, columnKey, onDragStart, onDragOver, onDrop, onDragEnd, onKeyDown, title, ...props }: React.ComponentProps<"th"> & { columnKey?: string }) {
  const context = React.useContext(ColumnOrderContext)
  const reorderable = Boolean(context && columnKey != null)
  const dragVisual = columnDragVisual(context, columnKey)
  const moveByKeyboard = (event: React.KeyboardEvent<HTMLTableCellElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || !context || columnKey == null || !event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return
    const index = context.order.indexOf(columnKey)
    const target = context.order[index + (event.key === "ArrowLeft" ? -1 : 1)]
    if (target == null) return
    event.preventDefault()
    context.move(columnKey, target)
  }
  return (
    <th
      data-slot="table-head"
      data-reorderable={reorderable || undefined}
      data-column-dragging={dragVisual.dragging || undefined}
      data-column-drop-side={dragVisual.dropSide}
      data-column-shift={dragVisual.shift}
      draggable={reorderable}
      tabIndex={reorderable ? 0 : props.tabIndex}
      title={reorderable ? title ?? "Drag to reorder column · Alt+Left/Right from the keyboard" : title}
      onDragStart={(event) => {
        onDragStart?.(event)
        if (!reorderable || event.defaultPrevented || columnKey == null) return
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData(COLUMN_DRAG_TYPE, columnKey)
        context?.startDrag(columnKey)
      }}
      onDragOver={(event) => {
        onDragOver?.(event)
        if (!reorderable || event.defaultPrevented) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        if (context && columnKey != null) {
          const bounds = event.currentTarget.getBoundingClientRect()
          context.hoverDrop(columnKey, event.clientX < bounds.left + bounds.width / 2 ? "before" : "after")
        }
      }}
      onDrop={(event) => {
        onDrop?.(event)
        if (!reorderable || event.defaultPrevented || !context || columnKey == null) return
        event.preventDefault()
        context.commitDrop()
      }}
      onDragEnd={(event) => { onDragEnd?.(event); context?.endDrag() }}
      onKeyDown={moveByKeyboard}
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground transition-[background-color,box-shadow,opacity,transform] duration-150 ease-out [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] data-[reorderable=true]:cursor-grab data-[reorderable=true]:active:cursor-grabbing data-[column-dragging=true]:scale-[0.98] data-[column-dragging=true]:opacity-35 data-[column-drop-side=before]:bg-primary/[0.10] data-[column-drop-side=before]:shadow-[inset_3px_0_0_var(--primary)] data-[column-drop-side=after]:bg-primary/[0.10] data-[column-drop-side=after]:shadow-[inset_-3px_0_0_var(--primary)] data-[column-shift=left]:-translate-x-1.5 data-[column-shift=right]:translate-x-1.5 motion-reduce:transition-none motion-reduce:transform-none",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, columnKey: _columnKey, ...props }: React.ComponentProps<"td"> & { columnKey?: string }) {
  const context = React.useContext(ColumnOrderContext)
  const dragVisual = columnDragVisual(context, _columnKey)
  return (
    <td
      data-slot="table-cell"
      data-column-dragging={dragVisual.dragging || undefined}
      data-column-drop-side={dragVisual.dropSide}
      data-column-shift={dragVisual.shift}
      className={cn(
        "p-2 align-middle whitespace-nowrap transition-[background-color,box-shadow,opacity,transform] duration-150 ease-out [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] data-[column-dragging=true]:opacity-35 data-[column-drop-side=before]:bg-primary/[0.04] data-[column-drop-side=before]:shadow-[inset_2px_0_0_var(--primary)] data-[column-drop-side=after]:bg-primary/[0.04] data-[column-drop-side=after]:shadow-[inset_-2px_0_0_var(--primary)] data-[column-shift=left]:-translate-x-1.5 data-[column-shift=right]:translate-x-1.5 motion-reduce:transition-none motion-reduce:transform-none",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
