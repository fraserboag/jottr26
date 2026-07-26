import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { AutoLinkPlugin } from '@lexical/react/LexicalAutoLinkPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { ListItemNode, ListNode } from '@lexical/list';
import { QuoteNode } from '@lexical/rich-text';
// CodeNode/LinkNode imported from the exact packages @lexical/markdown's
// transformers use, so their class-identity checks ($isCodeNode, the LINK
// transformer's dependencies) match the nodes registered below.
import { CodeNode } from '@lexical/code-core';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import {
  HEADING,
  INLINE_CODE,
  STRIKETHROUGH,
  TRANSFORMERS,
  type TextFormatTransformer,
} from '@lexical/markdown';
import { type SerializedEditorState } from 'lexical';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { updateNote, type Note } from '@/lib/notes';
import { useAutosave } from '@/lib/useAutosave';
import { useSyncStatus } from '@/lib/syncStatus';
import {
  CmdClickLinkPlugin,
  FloatingToolbarPlugin,
  PasteLinkPlugin,
  URL_MATCHERS,
} from './LinkPlugins';
import { MarkdownPastePlugin } from './MarkdownPastePlugin';
import styles from './NoteEditor.module.css';

// Strikethrough via a single tilde (~text~) instead of Lexical's default ~~.
const STRIKETHROUGH_TILDE: TextFormatTransformer = { ...STRIKETHROUGH, tag: '~' };

// Heading and inline-code shortcuts are intentionally omitted.
const NOTE_TRANSFORMERS = TRANSFORMERS.filter(
  (t) => t !== HEADING && t !== INLINE_CODE,
).map((t) => (t === STRIKETHROUGH ? STRIKETHROUGH_TILDE : t));

const editorTheme = {
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
  },
};

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

  // isEqual by value, not identity: OnChangePlugin hands back a fresh state
  // object per change, so an edit undone back to the same text would write.
  const { flush, status } = useAutosave(
    draft,
    (value) => {
      baselineRef.current = value;
      return updateNote(uid, note.id, value);
    },
    { isEqual: draftsEqual },
  );

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
            QuoteNode,
            ListNode,
            ListItemNode,
            CodeNode,
            LinkNode,
            AutoLinkNode,
          ],
          theme: editorTheme,
          editorState: JSON.stringify(note.content),
          onError(error) {
            throw error;
          },
        }}
      >
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
        <LinkPlugin />
        <AutoLinkPlugin matchers={URL_MATCHERS} />
        <PasteLinkPlugin />
        <MarkdownPastePlugin transformers={NOTE_TRANSFORMERS} />
        <CmdClickLinkPlugin />
        <FloatingToolbarPlugin />
        <MarkdownShortcutPlugin transformers={NOTE_TRANSFORMERS} />
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
