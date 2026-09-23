'use client'

import type { Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/react/menus'
import { useEditorState } from '@tiptap/react'
import { CellSelection, isInTable, selectedRect } from '@tiptap/pm/tables'
import { ToolButton } from '@/components/ui/ToolButton'

// Type-only, and load-bearing the same way it is in the slash extension: the
// table commands only exist on the chain where this package is in scope.
import type {} from '@tiptap/extension-table'
// Same reason: toggleFinance is registered by module augmentation.
import type {} from './extensions/finance'

/** The table's own DOM node, so the toolbar sits above the grid instead of
 *  hopping from cell to cell as the caret moves. */
function tableElement(editor: Editor): HTMLElement | null {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'table') {
      const dom = editor.view.nodeDOM($from.before(depth))
      return dom instanceof HTMLElement ? dom : null
    }
  }
  return null
}

/** What the table controls show, or null while the caret is outside a table.
 *
 *  `editor.can().deleteRow()` cannot drive the disabled state: prosemirror-tables
 *  puts its "would this empty the table?" guard behind the dispatch, so the dry
 *  run reports true for a delete that will refuse. Reading the same rect the
 *  command reads gives an answer that matches what the button will actually do.
 *
 *  The header toggle is read off the top row for the same reason: it always
 *  acts on row 0 whatever cell the caret is in, so `isActive('tableHeader')`
 *  would light the button only while you happened to be standing in a header. */
export function useTableState(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (!instance.isActive('table') || !isInTable(instance.state)) return null
      const rect = selectedRect(instance.state)
      return {
        rows: rect.map.height,
        cols: rect.map.width,
        canDeleteRow: !(rect.top === 0 && rect.bottom === rect.map.height),
        canDeleteColumn: !(rect.left === 0 && rect.right === rect.map.width),
        finance: rect.table.attrs.finance === true,
        headerRow: rect.map
          .cellsInRect({ left: 0, top: 0, right: rect.map.width, bottom: 1 })
          .every((pos) => rect.table.nodeAt(pos)?.type.name === 'tableHeader'),
      }
    },
  })
}

type TableState = NonNullable<ReturnType<typeof useTableState>>

/** The buttons for resizing a table while the caret is inside it. The `+`
 *  buttons insert after the row or column the caret is in — which, in the last
 *  one, is the same as appending — and `−` removes it. Shared by the bubble on
 *  desktop and the keyboard bar on touch screens. */
export function TableControls({ editor, state }: { editor: Editor; state: TableState }) {
  return (
    <>
      <span className="px-1.5 text-[13px] tabular-nums text-faint pointer-coarse:text-[14px] shrink-0 whitespace-nowrap">
        {state.rows} × {state.cols}
      </span>
      <span className="mx-1 h-6 w-px shrink-0 bg-line" />
      <span className="pl-1 text-[13px] text-muted pointer-coarse:text-[14px]">Rows</span>
      <ToolButton
        icon="minus"
        label="Delete this row"
        disabled={!state.canDeleteRow}
        onClick={() => editor.chain().focus().deleteRow().run()}
      />
      <ToolButton
        icon="plus"
        label="Add a row below"
        onClick={() => editor.chain().focus().addRowAfter().run()}
      />
      <span className="mx-1 h-6 w-px shrink-0 bg-line" />
      <span className="pl-1 text-[13px] text-muted pointer-coarse:text-[14px]">Cols</span>
      <ToolButton
        icon="minus"
        label="Delete this column"
        disabled={!state.canDeleteColumn}
        onClick={() => editor.chain().focus().deleteColumn().run()}
      />
      <ToolButton
        icon="plus"
        label="Add a column to the right"
        onClick={() => editor.chain().focus().addColumnAfter().run()}
      />
      <span className="mx-1 h-6 w-px shrink-0 bg-line" />
      <ToolButton
        icon="pound"
        label="Finance mode: format as money and total each column"
        active={state.finance}
        onClick={() => editor.chain().focus().toggleFinance().run()}
      />
      <ToolButton
        icon="tableHeader"
        label="Header row"
        active={state.headerRow}
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
      />
      <ToolButton
        icon="trash"
        label="Delete table"
        onClick={() => editor.chain().focus().deleteTable().run()}
      />
    </>
  )
}

/** The table controls as a bubble over the table, for desktop. Touch screens
 *  put the same controls on the keyboard bar instead. */
export function TableMenu({ editor }: { editor: Editor }) {
  const state = useTableState(editor)

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableMenu"
      options={{ placement: 'top', offset: 8 }}
      getReferencedVirtualElement={() => tableElement(editor)}
      shouldShow={({ editor: instance }) => {
        if (!instance.isEditable || !instance.isActive('table')) return false
        // Selecting text inside a cell is the format menu's business; showing
        // both at once would stack two toolbars over the same few pixels.
        const { selection } = instance.state
        return selection.empty || selection instanceof CellSelection
      }}
      // `shouldShow` runs on the transaction; the selector below lands a render
      // later, so the chrome is tied to the contents to keep an empty pill from
      // flashing in the gap. That also holds the pop-in back until there is
      // something to see.
      className={state ? 'flex items-center gap-1 rounded-xl border border-line bg-raised p-1 shadow-[var(--shadow-pop)] pop-in' : ''}
    >
      {state && <TableControls editor={editor} state={state} />}
    </BubbleMenu>
  )
}
