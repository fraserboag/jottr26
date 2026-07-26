import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { createLinkMatcherWithRegExp } from '@lexical/react/LexicalAutoLinkPlugin';
import {
  $createLinkNode,
  $isAutoLinkNode,
  $isLinkNode,
  TOGGLE_LINK_COMMAND,
  type LinkNode,
} from '@lexical/link';
import { $findMatchingParent, mergeRegister } from '@lexical/utils';
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  PASTE_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  type TextFormatType,
} from 'lexical';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Italic, Link, Pencil, Strikethrough, Unlink } from 'lucide-react';
import styles from './LinkPlugins.module.css';

// Every link the selection touches, even partially — unlinking acts on whole
// links, so selecting one character of a link is enough to act on all of it. A
// collapsed cursor resting in a link doesn't count, so the toolbar's link
// controls stay hidden until the user selects some text.
function $getLinksInSelection(): LinkNode[] {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || selection.isCollapsed()) return [];
  const links = new Map<string, LinkNode>();
  for (const node of selection.getNodes()) {
    const link = $isLinkNode(node)
      ? node
      : $findMatchingParent(node, $isLinkNode);
    // An unlinked auto-link is plain text as far as the user is concerned.
    if (!$isLinkNode(link) || ($isAutoLinkNode(link) && link.getIsUnlinked())) {
      continue;
    }
    links.set(link.getKey(), link);
  }
  return [...links.values()];
}

// Matches a URL anywhere in a run of text, but only with a protocol or a www.
// prefix — matching bare hosts too would linkify prose like "node.js".
const URL_REGEX =
  /((https?:\/\/(www\.)?)|(www\.))[-\w@:%.+~#=]{1,256}\.[a-z]{2,}\b[-\w()@:%+.~#?&/=]*/i;

const BARE_URL_REGEX = new RegExp(`^${URL_REGEX.source}$`, 'i');

const withProtocol = (text: string) =>
  text.startsWith('http') ? text : `https://${text}`;

export const URL_MATCHERS = [
  createLinkMatcherWithRegExp(URL_REGEX, withProtocol),
];

// Pasting a URL onto selected text links that text rather than replacing it.
// A paste at a plain cursor falls through to the default handling, where
// AutoLinkPlugin turns the inserted URL into a link of its own.
export function PasteLinkPlugin(): null {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!(event instanceof ClipboardEvent)) return false;
          const text = event.clipboardData?.getData('text/plain').trim();
          if (!text || !BARE_URL_REGEX.test(text)) return false;
          const selection = $getSelection();
          if (
            !$isRangeSelection(selection) ||
            selection.isCollapsed() ||
            selection.getTextContent().length === 0
          ) {
            return false;
          }
          event.preventDefault();
          editor.dispatchCommand(TOGGLE_LINK_COMMAND, withProtocol(text));
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );
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

const TEXT_FORMATS: {
  format: TextFormatType;
  label: string;
  Icon: typeof Bold;
}[] = [
  { format: 'bold', label: 'Bold', Icon: Bold },
  { format: 'italic', label: 'Italic', Icon: Italic },
  { format: 'strikethrough', label: 'Strikethrough', Icon: Strikethrough },
];

// Anchor rect is in shell coordinates; the bar's own position derives from it.
type ActiveSelection = {
  anchorTop: number;
  anchorBottom: number;
  anchorLeft: number;
  anchorWidth: number;
  formats: Set<TextFormatType>;
  links: { key: string; url: string }[];
};

const TOOLBAR_GAP = 8;
const SHELL_EDGE = 4;

// Touch puts the bar below the selection instead of above it: iOS shows its own
// callout (Copy / Look Up / Share) directly above a selection, and two bars
// fighting over that space is worse than the bar sitting further from the text.
const prefersBelow = () => window.matchMedia('(pointer: coarse)').matches;

// An auto-linked URL re-derives its href from its own text, so a URL set by
// hand has to leave the auto-link behind or AutoLinkPlugin would revert it.
function $setLinkUrl(node: LinkNode, url: string): void {
  if (!$isAutoLinkNode(node)) {
    node.setURL(url);
    return;
  }
  const link = $createLinkNode(url);
  for (const child of node.getChildren()) link.append(child);
  node.replace(link);
}

// Toolbar that floats over a non-empty text selection, toggling inline formats
// on it and editing any link it sits in — the URL input swaps into the same
// bar. Positioned off the native selection rect since a selection can span
// multiple nodes; buttons preventDefault on pointerdown so activating one
// doesn't collapse the selection being formatted. It only appears once the
// pointer is released, so it doesn't jump around during a drag-select.
export function FloatingToolbarPlugin(): React.ReactNode {
  const [editor] = useLexicalComposerContext();
  const [active, setActive] = useState<ActiveSelection | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftUrl, setDraftUrl] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  // Key of the link whose URL is being edited, readable from the update()
  // closure (deps: [editor]) so it can hold the bar still and commit later.
  const editingKeyRef = useRef<string | null>(null);
  // Mirrors draftUrl so that same closure can read the latest typed value.
  const draftRef = useRef(draftUrl);
  useEffect(() => {
    draftRef.current = draftUrl;
  }, [draftUrl]);

  useEffect(() => {
    // Applies the typed URL to the link left behind, dropping the link when the
    // field was left empty. Blur can't be relied on here since the bar may
    // unmount (via pointerdown) before the input's blur reaches React.
    const resolveEdit = (key: string) => {
      editingKeyRef.current = null;
      const draft = draftRef.current.trim();
      editor.update(() => {
        const node = $getNodeByKey(key);
        if (!$isLinkNode(node)) return;
        if (draft) {
          $setLinkUrl(node, draft);
        } else {
          for (const child of node.getChildren()) node.insertBefore(child);
          node.remove();
        }
      });
    };
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
          links: $getLinksInSelection().map((link) => ({
            key: link.getKey(),
            url: link.getURL(),
          })),
        };
      });
      const editingKey = editingKeyRef.current;
      if (editingKey) {
        // Hold the bar where it is while the input has focus — the DOM
        // selection lives inside the input, so there's no rect to track.
        if (info?.links.some((link) => link.key === editingKey)) return;
        resolveEdit(editingKey);
        setEditing(false);
      }
      const domSelection = window.getSelection();
      if (!info || !shell || !domSelection || domSelection.rangeCount === 0) {
        setActive(null);
        return;
      }
      const rect = domSelection.getRangeAt(0).getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      setActive({
        ...info,
        anchorTop: rect.top - shellRect.top + shell.scrollTop,
        anchorBottom: rect.bottom - shellRect.top + shell.scrollTop,
        anchorLeft: rect.left - shellRect.left + shell.scrollLeft,
        anchorWidth: rect.width,
      });
      // A link created empty (by the link button) opens its input straight away.
      if (info.links.length === 1 && info.links[0].url === '') {
        editingKeyRef.current = info.links[0].key;
        setDraftUrl('');
        setEditing(true);
      }
    };
    // On the document rather than the editor root, because iOS draws the
    // grabbers that adjust a selection as OS-level UI outside it — a
    // root-scoped listener never sees that drag, and the bar would chase the
    // selection through every intermediate position. The bar's own pointers
    // are exempt, or tapping a button would dismiss it before the click landed.
    const onPointerDown = (event: PointerEvent) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      draggingRef.current = true;
      setActive(null);
    };
    const onPointerUp = () => {
      draggingRef.current = false;
      update();
    };
    document.addEventListener('pointerdown', onPointerDown);
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
        document.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointerup', onPointerUp);
      },
    );
  }, [editor]);

  useLayoutEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  // Centres the bar on the selection, clamped inside the shell (which clips it
  // — overflow-y: auto scrolls both axes) and flipped to the other side when
  // the preferred one has no room. Re-runs on content changes since the bar's
  // measured width drives the clamp.
  useLayoutEffect(() => {
    const el = popoverRef.current;
    const shell = editor.getRootElement()?.parentElement;
    if (!el || !shell || !active) return;
    const { width, height } = el.getBoundingClientRect();
    const centred = active.anchorLeft + active.anchorWidth / 2 - width / 2;
    const minLeft = shell.scrollLeft + SHELL_EDGE;
    const maxLeft = minLeft + shell.clientWidth - width - SHELL_EDGE * 2;
    const above = active.anchorTop - height - TOOLBAR_GAP;
    const below = active.anchorBottom + TOOLBAR_GAP;
    const fitsAbove = above >= shell.scrollTop + SHELL_EDGE;
    const fitsBelow =
      below + height <= shell.scrollTop + shell.clientHeight - SHELL_EDGE;
    setPosition({
      left: Math.max(minLeft, Math.min(centred, maxLeft)),
      top: prefersBelow()
        ? fitsBelow || !fitsAbove
          ? below
          : above
        : fitsAbove
          ? above
          : below,
    });
  }, [active, editing, draftUrl, editor]);

  if (!active) return null;
  const shell = editor.getRootElement()?.parentElement;
  if (!shell) return null;
  // The URL is only shown (and editable) when the selection is about a single
  // link; touching several is still enough to unlink them all.
  const link = active.links.length === 1 ? active.links[0] : null;
  const hasLinks = active.links.length > 0;

  const removeLinks = (keys: string[]) => {
    editingKeyRef.current = null;
    editor.update(() => {
      for (const key of keys) {
        const node = $getNodeByKey(key);
        if (!$isLinkNode(node)) continue;
        // Unwrapping an auto-link would only leave URL text for AutoLinkPlugin
        // to re-link, so flag it as unlinked instead — its own way of saying
        // that.
        if ($isAutoLinkNode(node)) {
          node.setIsUnlinked(true);
          node.markDirty();
          continue;
        }
        for (const child of node.getChildren()) node.insertBefore(child);
        node.remove();
      }
    });
    setEditing(false);
  };

  const commitUrl = () => {
    const key = editingKeyRef.current;
    if (!key) return;
    const url = draftUrl.trim();
    if (!url) {
      removeLinks([key]);
      return;
    }
    editingKeyRef.current = null;
    editor.update(() => {
      const node = $getNodeByKey(key);
      if ($isLinkNode(node)) $setLinkUrl(node, url);
    });
    setEditing(false);
  };

  // Cancelling a never-committed (empty) link drops it entirely, rather than
  // leaving an empty-href link in the document.
  const cancelEdit = () => {
    const key = editingKeyRef.current;
    if (!key) return;
    if (link?.url) {
      editingKeyRef.current = null;
      setEditing(false);
    } else {
      removeLinks([key]);
    }
  };

  const startEdit = (key: string, url: string) => {
    editingKeyRef.current = key;
    setDraftUrl(url);
    setEditing(true);
  };

  const toggleLink = () => {
    if (hasLinks) {
      removeLinks(active.links.map((l) => l.key));
      return;
    }
    editor.update(() => {
      const selection = $getSelection();
      const autoLink = $isRangeSelection(selection)
        ? $findMatchingParent(selection.anchor.getNode(), $isAutoLinkNode)
        : null;
      // Re-linking text that was unlinked above just clears the flag; the URL
      // comes back from the text itself.
      if ($isAutoLinkNode(autoLink) && autoLink.getIsUnlinked()) {
        autoLink.setIsUnlinked(false);
        autoLink.markDirty();
        return;
      }
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, '');
    });
  };

  return createPortal(
    <div
      ref={popoverRef}
      className={styles.popover}
      style={{ top: position.top, left: position.left }}
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
              editor.focus();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
              editor.focus();
            }
          }}
          onBlur={commitUrl}
          placeholder='https://example.com'
          aria-label='Link URL'
        />
      ) : (
        <>
          {TEXT_FORMATS.map(({ format, label, Icon }) => {
            const isActive = active.formats.has(format);
            return (
              <button
                key={format}
                type='button'
                className={
                  isActive
                    ? `${styles.button} ${styles.buttonActive}`
                    : styles.button
                }
                aria-label={label}
                aria-pressed={isActive}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() =>
                  editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
                }
              >
                <Icon size={16} />
              </button>
            );
          })}
          {link && (
            <>
              <a
                className={styles.url}
                href={link.url}
                target='_blank'
                rel='noopener noreferrer'
              >
                {link.url}
              </a>
              <button
                type='button'
                className={styles.button}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => startEdit(link.key, link.url)}
                aria-label='Edit link'
              >
                <Pencil size={16} />
              </button>
            </>
          )}
          <button
            type='button'
            className={
              hasLinks
                ? `${styles.button} ${styles.buttonActive}`
                : styles.button
            }
            aria-label={hasLinks ? 'Remove link' : 'Add link'}
            aria-pressed={hasLinks}
            onPointerDown={(e) => e.preventDefault()}
            onClick={toggleLink}
          >
            {hasLinks ? <Unlink size={16} /> : <Link size={16} />}
          </button>
        </>
      )}
    </div>,
    shell,
  );
}
