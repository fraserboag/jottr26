import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import {
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
} from '@lexical/list';
import {
  $createHeadingNode,
  HeadingNode,
  QuoteNode,
  type HeadingTagType,
} from '@lexical/rich-text';
// CodeNode/LinkNode imported from the exact packages @lexical/markdown's
// transformers use, so their class-identity checks ($isCodeNode, the LINK
// transformer's dependencies) match the nodes registered below.
import { CodeNode } from '@lexical/code-core';
import { LinkNode } from '@lexical/link';
import { TRANSFORMERS } from '@lexical/markdown';
import { $setBlocksType } from '@lexical/selection';
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  type SerializedEditorState,
} from 'lexical';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Bold,
  Heading1,
  Heading2,
  Italic,
  List,
  Pilcrow,
} from 'lucide-react';
import { updateNote, type Note } from '@/lib/notes';
import { useAutosave } from '@/lib/useAutosave';
import { useSyncStatus } from '@/lib/syncStatus';
import styles from './NoteEditor.module.css';

const editorTheme = {
  heading: { h1: styles.h1, h2: styles.h2 },
  list: {
    ul: styles.ul,
    ol: styles.ol,
    listitem: styles.listItem,
    // Strips the marker from a list item that only wraps a nested list, so
    // Tab-nesting doesn't show a stray bullet on the parent line.
    nested: { listitem: styles.nestedListItem },
  },
  quote: styles.quote,
  code: styles.code,
  link: styles.link,
  text: {
    bold: styles.bold,
    italic: styles.italic,
    strikethrough: styles.strikethrough,
    code: styles.inlineCode,
  },
};

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
    <div className={styles.toolbar}>
      <button
        type='button'
        aria-label='Bold'
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
      >
        <Bold size={16} />
      </button>
      <button
        type='button'
        aria-label='Italic'
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
      >
        <Italic size={16} />
      </button>
      <button type='button' aria-label='Heading 1' onClick={() => setHeading('h1')}>
        <Heading1 size={16} />
      </button>
      <button type='button' aria-label='Heading 2' onClick={() => setHeading('h2')}>
        <Heading2 size={16} />
      </button>
      <button type='button' aria-label='Normal text' onClick={setParagraph}>
        <Pilcrow size={16} />
      </button>
      <button
        type='button'
        aria-label='Bulleted list'
        onClick={() =>
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
        }
      >
        <List size={16} />
      </button>
    </div>
  );
}

type Draft = { title: string; content: SerializedEditorState };

function draftsEqual(a: Draft, b: Draft): boolean {
  return (
    a.title === b.title &&
    JSON.stringify(a.content) === JSON.stringify(b.content)
  );
}

// Applies a remotely-synced content update to the live editor. Lexical only
// reads `initialConfig.editorState` once on mount, so pushing a resynced
// value into `draft` alone wouldn't be reflected here without this. Only
// renders (and only fires) when a resync actually happens — see `content`
// below — not on every keystroke, since OnChangePlugin already keeps the
// editor's own edits flowing the other way, into `draft`.
function RemoteContentSync({ content }: { content: SerializedEditorState }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditorState(editor.parseEditorState(JSON.stringify(content)));
  }, [editor, content]);
  return null;
}

type NoteEditorProps = { uid: string; note: Note };

// Keyed on note.id by the caller, so each note gets a fresh instance. Draft
// resyncs from `note` whenever there are no unsaved local edits, so an
// update arriving from elsewhere (another tab/device) while this note is
// open is picked up automatically. If there ARE unsaved local edits, the
// remote value is left alone until this instance's own autosave lands —
// Firestore's normal last-write-wins-by-arrival rule then decides the
// outcome, same as any other same-field conflict.
function NoteEditor({ uid, note }: NoteEditorProps) {
  const location = useLocation();
  const focusTitle = (location.state as { focusTitle?: boolean } | null)
    ?.focusTitle;
  const [draft, setDraft] = useState<Draft>({
    title: note.title,
    content: note.content,
  });
  const baselineRef = useRef(draft);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const [editorSyncContent, setEditorSyncContent] =
    useState<SerializedEditorState | null>(null);

  useEffect(() => {
    const incoming: Draft = { title: note.title, content: note.content };
    if (
      draftsEqual(incoming, baselineRef.current) ||
      !draftsEqual(draftRef.current, baselineRef.current)
    ) {
      return;
    }
    baselineRef.current = incoming;
    setDraft(incoming);
    setEditorSyncContent(incoming.content);
  }, [note]);

  const { flush, status } = useAutosave(draft, (value) => {
    baselineRef.current = value;
    return updateNote(uid, note.id, value);
  });

  const { setStatus } = useSyncStatus();
  useEffect(() => {
    setStatus(status);
  }, [status, setStatus]);
  useEffect(() => () => setStatus('synced'), [setStatus]);

  return (
    <div className={styles.pane}>
      <input
        className={styles.title}
        value={draft.title}
        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        onBlur={flush}
        placeholder='Title'
        aria-label='Note title'
        autoFocus={focusTitle}
      />
      <LexicalComposer
        initialConfig={{
          namespace: 'jottr-note',
          nodes: [
            HeadingNode,
            QuoteNode,
            ListNode,
            ListItemNode,
            CodeNode,
            LinkNode,
          ],
          theme: editorTheme,
          editorState: JSON.stringify(note.content),
          onError(error) {
            throw error;
          },
        }}
      >
        <Toolbar />
        {editorSyncContent && <RemoteContentSync content={editorSyncContent} />}
        <RichTextPlugin
          contentEditable={
            <div className={styles.editorShell}>
              <ContentEditable
                className={styles.contentEditable}
                aria-placeholder='Start writing…'
                placeholder={
                  <div className={styles.placeholder}>Start writing…</div>
                }
                onBlur={flush}
              />
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <TabIndentationPlugin />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(editorState) =>
            setDraft((d) => ({ ...d, content: editorState.toJSON() }))
          }
        />
      </LexicalComposer>
    </div>
  );
}

export default NoteEditor;
