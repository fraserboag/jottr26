'use client'

import type { Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/react/menus'
import { NodeSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { useEditorState } from '@tiptap/react'
import { LinkPicker } from './LinkPicker'
import { FormatButtons, formatFlags, useLinkEditing } from './formatActions'

export function FormatMenu({ editor, pageId }: { editor: Editor; pageId: string }) {
  const link = useLinkEditing(editor)

  // v3 does not re-render on every transaction by default, which is what keeps
  // typing cheap; this subscribes to just the flags the toolbar draws.
  const flags = useEditorState({ editor, selector: ({ editor: instance }) => formatFlags(instance) })

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor: instance, from, to }) => {
        if (from === to) return false
        // The title takes no marks, so a toolbar over it would only mislead.
        if (instance.isActive('title')) return false
        // Whole cells selected is a table gesture, not a text one; the table
        // toolbar is already showing for it.
        if (instance.state.selection instanceof CellSelection) return false
        // A block selected whole, to be deleted or moved, is not text to
        // format; the text inside it is, selected on its own.
        if (instance.state.selection instanceof NodeSelection) return false
        return !instance.isActive('codeBlock')
      }}
      className="flex items-center gap-1 rounded-xl border border-line bg-raised p-1 shadow-[var(--shadow-pop)] pop-in"
    >
      {link.open ? (
        <LinkPicker
          initialHref={link.value}
          onApply={link.apply}
          onUnset={link.clear}
          onClose={link.close}
        />
      ) : (
        <FormatButtons
          editor={editor}
          pageId={pageId}
          flags={flags}
          onLink={link.start}
          separatorClassName="mx-1 h-6 w-px bg-line"
        />
      )}
    </BubbleMenu>
  )
}
