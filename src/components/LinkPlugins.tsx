import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $isLinkNode, TOGGLE_LINK_COMMAND, type LinkNode } from '@lexical/link';
import { $findMatchingParent, mergeRegister } from '@lexical/utils';
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
  type TextFormatType,
} from 'lexical';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Italic, Link, Pencil, Strikethrough, Unlink } from 'lucide-react';
import styles from './LinkPlugins.module.css';

// Only reports a link when its text is actually selected — a collapsed cursor
// resting inside a link doesn't count, so the editor popover stays hidden
// until the user selects the link text.
function $getLinkInSelection(): LinkNode | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || selection.isCollapsed()) return null;
  const anchorLink = $findMatchingParent(
    selection.anchor.getNode(),
    $isLinkNode,
  );
  const focusLink = $findMatchingParent(selection.focus.getNode(), $isLinkNode);
  if ($isLinkNode(anchorLink) && anchorLink.is(focusLink)) return anchorLink;
  return null;
}

// Opens links on cmd/ctrl+click, and shows a pointer cursor while the modifier
// is held (via a data attribute on the root that CSS keys off of). A plain
// click keeps its default behaviour of placing the cursor, so editing isn't
// hijacked. The modifier is cmd on macOS and ctrl elsewhere.
export function CmdClickLinkPlugin(): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (!anchor) return;
      event.preventDefault();
      window.open(anchor.href, '_blank', 'noopener,noreferrer');
    };
    const syncModifier = (event: KeyboardEvent) => {
      const root = editor.getRootElement();
      if (!root) return;
      if (event.metaKey || event.ctrlKey) {
        root.setAttribute('data-modifier-down', 'true');
      } else {
        root.removeAttribute('data-modifier-down');
      }
    };
    const clearModifier = () =>
      editor.getRootElement()?.removeAttribute('data-modifier-down');
    window.addEventListener('keydown', syncModifier);
    window.addEventListener('keyup', syncModifier);
    window.addEventListener('blur', clearModifier);
    const unregisterRoot = editor.registerRootListener((root, prevRoot) => {
      prevRoot?.removeEventListener('click', onClick);
      root?.addEventListener('click', onClick);
    });
    return () => {
      window.removeEventListener('keydown', syncModifier);
      window.removeEventListener('keyup', syncModifier);
      window.removeEventListener('blur', clearModifier);
      unregisterRoot();
    };
  }, [editor]);
  return null;
}

type ActiveLink = { key: string; url: string; top: number; left: number };

// Popover that appears when a link's text is selected, showing its URL with
// controls to edit the URL or remove the link.
export function FloatingLinkEditorPlugin(): React.ReactNode {
  const [editor] = useLexicalComposerContext();
  const [active, setActive] = useState<ActiveLink | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftUrl, setDraftUrl] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Tracks the link we've already auto-opened for editing, so a link created
  // empty (e.g. from the format toolbar) opens its input exactly once.
  const autoEditKeyRef = useRef<string | null>(null);
  const draggingRef = useRef(false);
  // Mirrors draftUrl so the update() closure (deps: [editor]) can read the
  // latest typed value when committing on pointer-release.
  const draftRef = useRef(draftUrl);
  useEffect(() => {
    draftRef.current = draftUrl;
  }, [draftUrl]);

  useEffect(() => {
    const update = () => {
      if (draggingRef.current) return;
      const shell = editor.getRootElement()?.parentElement;
      const info = editor.getEditorState().read(() => {
        const link = $getLinkInSelection();
        return link ? { key: link.getKey(), url: link.getURL() } : null;
      });
      // Resolve an auto-created link the user moved away from: save the typed
      // URL, or drop the link if the field was left empty. Blur can't be
      // relied on here since the popover may unmount (via pointerdown) before
      // the input's blur reaches React.
      const pendingKey = autoEditKeyRef.current;
      if (pendingKey && pendingKey !== info?.key) {
        autoEditKeyRef.current = null;
        const draft = draftRef.current.trim();
        editor.update(() => {
          const node = $getNodeByKey(pendingKey);
          if (!$isLinkNode(node)) return;
          if (draft) {
            node.setURL(draft);
          } else if (node.getURL() === '') {
            for (const child of node.getChildren()) node.insertBefore(child);
            node.remove();
          }
        });
      }
      if (!info || !shell) {
        setActive(null);
        setEditing(false);
        return;
      }
      if (info.url === '' && autoEditKeyRef.current !== info.key) {
        autoEditKeyRef.current = info.key;
        setDraftUrl('');
        setEditing(true);
      }
      const linkEl = editor.getElementByKey(info.key);
      if (!linkEl) {
        setActive(null);
        return;
      }
      const rect = linkEl.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      setActive({
        key: info.key,
        url: info.url,
        top: rect.bottom - shellRect.top + shell.scrollTop + 4,
        left: rect.left - shellRect.left + shell.scrollLeft,
      });
    };
    const onPointerDown = () => {
      draggingRef.current = true;
      setActive(null);
    };
    const onPointerUp = () => {
      draggingRef.current = false;
      update();
    };
    const unregisterRoot = editor.registerRootListener((root, prevRoot) => {
      prevRoot?.removeEventListener('pointerdown', onPointerDown);
      root?.addEventListener('pointerdown', onPointerDown);
    });
    window.addEventListener('pointerup', onPointerUp);
    return mergeRegister(
      editor.registerUpdateListener(update),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          update();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      () => {
        unregisterRoot();
        window.removeEventListener('pointerup', onPointerUp);
      },
    );
  }, [editor]);

  useLayoutEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  if (!active) return null;
  const shell = editor.getRootElement()?.parentElement;
  if (!shell) return null;

  const removeLink = () => {
    autoEditKeyRef.current = null;
    editor.update(() => {
      const node = $getNodeByKey(active.key);
      if ($isLinkNode(node)) {
        for (const child of node.getChildren()) node.insertBefore(child);
        node.remove();
      }
    });
    setActive(null);
    setEditing(false);
  };

  const commitUrl = () => {
    const url = draftUrl.trim();
    if (!url) {
      removeLink();
      return;
    }
    autoEditKeyRef.current = null;
    editor.update(() => {
      const node = $getNodeByKey(active.key);
      if ($isLinkNode(node)) node.setURL(url);
    });
    setEditing(false);
  };

  // Cancelling a never-committed (empty) link drops it entirely, rather than
  // leaving an empty-href link in the document.
  const cancelEdit = () => {
    if (active.url) setEditing(false);
    else removeLink();
  };

  return createPortal(
    <div
      className={styles.popover}
      style={{ top: active.top, left: active.left }}
    >
      {editing ? (
        <input
          ref={inputRef}
          className={styles.input}
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitUrl();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
            }
          }}
          onBlur={commitUrl}
          placeholder='https://example.com'
          aria-label='Link URL'
        />
      ) : (
        <>
          <a
            className={styles.url}
            href={active.url}
            target='_blank'
            rel='noopener noreferrer'
          >
            {active.url}
          </a>
          <button
            type='button'
            className={styles.button}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setDraftUrl(active.url);
              setEditing(true);
            }}
            aria-label='Edit link'
          >
            <Pencil size={16} />
          </button>
        </>
      )}
    </div>,
    shell,
  );
}

const TEXT_FORMATS: {
  format: TextFormatType;
  label: string;
  Icon: typeof Bold;
}[] = [
  { format: 'bold', label: 'Bold', Icon: Bold },
  { format: 'italic', label: 'Italic', Icon: Italic },
  { format: 'strikethrough', label: 'Strikethrough', Icon: Strikethrough },
];

type ActiveSelection = {
  top: number;
  left: number;
  formats: Set<TextFormatType>;
  isLink: boolean;
};

// Toolbar that floats above a non-empty text selection, toggling inline
// formats (and links) on it. Positioned off the native selection rect since a
// selection can span multiple nodes; buttons preventDefault on mousedown so
// clicking one doesn't collapse the selection being formatted. It only appears
// once the pointer is released, so it doesn't jump around during a drag-select.
export function FloatingFormatToolbarPlugin(): React.ReactNode {
  const [editor] = useLexicalComposerContext();
  const [active, setActive] = useState<ActiveSelection | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const update = () => {
      if (draggingRef.current) return;
      const shell = editor.getRootElement()?.parentElement;
      const info = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (
          !$isRangeSelection(selection) ||
          selection.isCollapsed() ||
          selection.getTextContent().length === 0
        ) {
          return null;
        }
        return {
          formats: new Set(
            TEXT_FORMATS.map((f) => f.format).filter((f) =>
              selection.hasFormat(f),
            ),
          ),
          isLink: $getLinkInSelection() !== null,
        };
      });
      const domSelection = window.getSelection();
      if (!info || !shell || !domSelection || domSelection.rangeCount === 0) {
        setActive(null);
        return;
      }
      const rect = domSelection.getRangeAt(0).getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      setActive({
        ...info,
        top: rect.top - shellRect.top + shell.scrollTop,
        left: rect.left - shellRect.left + shell.scrollLeft + rect.width / 2,
      });
    };
    const onPointerDown = () => {
      draggingRef.current = true;
      setActive(null);
    };
    const onPointerUp = () => {
      draggingRef.current = false;
      update();
    };
    const unregisterRoot = editor.registerRootListener((root, prevRoot) => {
      prevRoot?.removeEventListener('pointerdown', onPointerDown);
      root?.addEventListener('pointerdown', onPointerDown);
    });
    window.addEventListener('pointerup', onPointerUp);
    return mergeRegister(
      editor.registerUpdateListener(update),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          update();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      () => {
        unregisterRoot();
        window.removeEventListener('pointerup', onPointerUp);
      },
    );
  }, [editor]);

  if (!active) return null;
  const shell = editor.getRootElement()?.parentElement;
  if (!shell) return null;

  const toggleLink = () =>
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, active.isLink ? null : '');

  return createPortal(
    <div
      className={`${styles.popover} ${styles.formatToolbar}`}
      style={{ top: active.top, left: active.left }}
    >
      {TEXT_FORMATS.map(({ format, label, Icon }) => {
        const isActive = active.formats.has(format);
        return (
          <button
            key={format}
            type='button'
            className={
              isActive ? `${styles.button} ${styles.buttonActive}` : styles.button
            }
            aria-label={label}
            aria-pressed={isActive}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)}
          >
            <Icon size={16} />
          </button>
        );
      })}
      <button
        type='button'
        className={
          active.isLink ? `${styles.button} ${styles.buttonActive}` : styles.button
        }
        aria-label={active.isLink ? 'Remove link' : 'Add link'}
        aria-pressed={active.isLink}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggleLink}
      >
        {active.isLink ? <Unlink size={16} /> : <Link size={16} />}
      </button>
    </div>,
    shell,
  );
}
