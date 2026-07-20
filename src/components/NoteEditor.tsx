import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { INSERT_UNORDERED_LIST_COMMAND, ListItemNode, ListNode } from '@lexical/list';
import { $createHeadingNode, HeadingNode, type HeadingTagType } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  type SerializedEditorState,
} from 'lexical';
import { useState } from 'react';
import { updateNote, type Note } from '@/lib/notes';
import { useAutosave } from '@/lib/useAutosave';

function Toolbar() {
  const [editor] = useLexicalComposerContext();

  const setHeading = (tag: HeadingTagType) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createHeadingNode(tag));
      }
    });
  };

  const setParagraph = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createParagraphNode());
      }
    });
  };

  return (
    <div>
      <button type='button' aria-label='Bold' onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}>
        B
      </button>
      <button type='button' aria-label='Italic' onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}>
        I
      </button>
      <button type='button' onClick={() => setHeading('h1')}>
        H1
      </button>
      <button type='button' onClick={() => setHeading('h2')}>
        H2
      </button>
      <button type='button' onClick={setParagraph}>
        Normal
      </button>
      <button type='button' onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}>
        List
      </button>
    </div>
  );
}

type Draft = { title: string; content: SerializedEditorState };

type NoteEditorProps = { uid: string; note: Note };

// Keyed on note.id by the caller, so each note gets a fresh instance: local
// draft state and the LexicalComposer both initialize once from `note` and
// are never resynced from it afterwards — see CODING_STANDARDS.md on same-
// field conflicts for why an update arriving from elsewhere while this note
// is open doesn't get reflected here.
//
// Unstyled: reset.css strips heading font-size/weight and list markers down
// to nothing, so as-is, clicking H1/H2/List produces no visible change —
// needs styling before this is usable.
function NoteEditor({ uid, note }: NoteEditorProps) {
  const [draft, setDraft] = useState<Draft>({ title: note.title, content: note.content });

  const { flush } = useAutosave(draft, (value) => updateNote(uid, note.id, value));

  return (
    <div>
      <input
        value={draft.title}
        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        onBlur={flush}
        placeholder='Title'
        aria-label='Note title'
      />

      <LexicalComposer
        initialConfig={{
          namespace: 'jottr-note',
          nodes: [HeadingNode, ListNode, ListItemNode],
          theme: {},
          editorState: JSON.stringify(note.content),
          onError(error) {
            throw error;
          },
        }}
      >
        <Toolbar />
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-placeholder='Start writing…'
              placeholder={<div>Start writing…</div>}
              onBlur={flush}
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <OnChangePlugin onChange={(editorState) => setDraft((d) => ({ ...d, content: editorState.toJSON() }))} />
      </LexicalComposer>
    </div>
  );
}

export default NoteEditor;
