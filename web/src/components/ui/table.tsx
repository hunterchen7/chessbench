import * as React from "react"

import { cn } from "@/lib/utils"
import { usePersistentColumnOrder } from "@/lib/usePersistentColumnOrder"

interface ColumnOrderContextValue {
  columnCount: number
  order: string[]
  move: (source: string, target: string) => void
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
  const { order, move } = usePersistentColumnOrder(reorderableKey, columnCount)

  const context = React.useMemo<ColumnOrderContextValue | null>(() => reorderableKey && columnCount > 1 ? {
    columnCount,
    order,
    move,
  } : null, [columnCount, move, order, reorderableKey])

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

function TableHead({ className, columnKey, onDragStart, onDragOver, onDrop, onKeyDown, title, ...props }: React.ComponentProps<"th"> & { columnKey?: string }) {
  const context = React.useContext(ColumnOrderContext)
  const reorderable = Boolean(context && columnKey != null)
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
      draggable={reorderable}
      tabIndex={reorderable ? 0 : props.tabIndex}
      title={reorderable ? title ?? "Drag to reorder column · Alt+Left/Right from the keyboard" : title}
      onDragStart={(event) => {
        onDragStart?.(event)
        if (!reorderable || event.defaultPrevented || columnKey == null) return
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData(COLUMN_DRAG_TYPE, columnKey)
      }}
      onDragOver={(event) => {
        onDragOver?.(event)
        if (!reorderable || event.defaultPrevented) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
      }}
      onDrop={(event) => {
        onDrop?.(event)
        if (!reorderable || event.defaultPrevented || !context || columnKey == null) return
        event.preventDefault()
        context.move(event.dataTransfer.getData(COLUMN_DRAG_TYPE), columnKey)
      }}
      onKeyDown={moveByKeyboard}
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] data-[reorderable=true]:cursor-grab data-[reorderable=true]:active:cursor-grabbing",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, columnKey: _columnKey, ...props }: React.ComponentProps<"td"> & { columnKey?: string }) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
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
