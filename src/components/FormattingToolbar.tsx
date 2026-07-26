import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
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
  BLUR_COMMAND,
  FOCUS_COMMAND,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
  type TextFormatType,
} from 'lexical';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Italic, Link, Pencil, Strikethrough, Unlink } from 'lucide-react';
import styles from './FormattingToolbar.module.css';

// Every link the selection touches, even partially — unlinking acts on whole
// links, so selecting one character of a link is enough to act on all of it. A
// collapsed cursor resting in a link doesn't count, so the link controls stay
// inert until the user selects some text.
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

const TEXT_FORMATS: {
  format: TextFormatType;
  label: string;
  Icon: typeof Bold;
}[] = [
  { format: 'bold', label: 'Bold', Icon: Bold },
  { format: 'italic', label: 'Italic', Icon: Italic },
  { format: 'strikethrough', label: 'Strikethrough', Icon: Strikethrough },
];

type ToolbarState = {
  formats: Set<TextFormatType>;
  links: { key: string; url: string }[];
  hasSelection: boolean;
};

// Selection rect in shell coordinates; the floating bar's position derives
// from it. Unused when docked, which needs no anchor at all.
type Anchor = { top: number; bottom: number; left: number; width: number };

const EMPTY_STATE: ToolbarState = {
  formats: new Set(),
  links: [],
  hasSelection: false,
};

const TOOLBAR_GAP = 8;
const SHELL_EDGE = 4;

// How a button is activated depends on the presentation. A mouse keeps the
// selection by cancelling mousedown's default and acting on the click. Touch
// can't: the bar's non-passive touchstart handler has already cancelled the
// tap to stop iOS blurring the editor, which suppresses the click iOS would
// otherwise synthesise — so touch acts on touchend. The two are mutually
// exclusive rather than both registered, since a click that did slip through
// would toggle the format straight back off.
const preventDefault = (event: React.MouseEvent) => event.preventDefault();

// Touch docks the bar above the keyboard instead of floating it over the
// selection: iOS puts its own Cut/Copy/Paste callout there and won't yield it,
// and a docked bar can act on a collapsed cursor, which a selection-anchored
// one cannot.
function useIsDocked(): boolean {
  const [docked, setDocked] = useState(
    () => window.matchMedia('(pointer: coarse)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const sync = () => setDocked(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return docked;
}

// Toggles inline formats and edits any link the selection sits in — the URL
// input swaps into the same bar. Two presentations over one set of state: a bar
// docked above the keyboard on touch, shown whenever the editor has focus, and
// a popover floating over the selection on a mouse, shown only when there is
// one. Buttons preventDefault on pointerdown so activating one doesn't collapse
// the selection being formatted.
export function FormattingToolbarPlugin(): React.ReactNode {
  const [editor] = useLexicalComposerContext();
  const docked = useIsDocked();
  const [state, setState] = useState<ToolbarState | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [focused, setFocused] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftUrl, setDraftUrl] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [keyboardInset, setKeyboardInset] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  // Key of the link whose URL is being edited, readable from the update()
  // closure so it can hold the bar still and commit later.
  const editingKeyRef = useRef<string | null>(null);
  // Mirrors draftUrl so that same closure can read the latest typed value.
  const draftRef = useRef(draftUrl);
  useEffect(() => {
    draftRef.current = draftUrl;
  }, [draftUrl]);

  // Native and non-passive, because React registers touchstart as passive at
  // the root and silently drops preventDefault from a synthetic handler. This
  // is what keeps the editor focused when a button is tapped: iOS moves focus
  // (closing the keyboard and dropping the selection) off the touch itself,
  // which preventDefault on pointerdown does not suppress. Only buttons are
  // prevented — the URL input still has to be tappable to focus.
  const barRef = useCallback(
    (node: HTMLDivElement | null) => {
      popoverRef.current = node;
      if (!node || !docked) return;
      const onTouchStart = (event: TouchEvent) => {
        if ((event.target as HTMLElement).closest('button')) {
          event.preventDefault();
        }
      };
      node.addEventListener('touchstart', onTouchStart, { passive: false });
      return () => {
        popoverRef.current = null;
        node.removeEventListener('touchstart', onTouchStart);
      };
    },
    [docked],
  );

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
      const info = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return null;
        return {
          // Read even when collapsed: the docked bar toggles the format that
          // the next typed characters will carry.
          formats: new Set(
            TEXT_FORMATS.map((f) => f.format).filter((f) =>
              selection.hasFormat(f),
            ),
          ),
          links: $getLinksInSelection().map((link) => ({
            key: link.getKey(),
            url: link.getURL(),
          })),
          hasSelection:
            !selection.isCollapsed() &&
            selection.getTextContent().length > 0,
        };
      });

      const editingKey = editingKeyRef.current;
      if (editingKey) {
        // Hold the bar still while the input has focus — the DOM selection
        // lives inside the input, so there's no rect to track.
        if (info?.links.some((link) => link.key === editingKey)) return;
        resolveEdit(editingKey);
        setEditing(false);
      }

      setState(info);

      const shell = editor.getRootElement()?.parentElement;
      const domSelection = window.getSelection();
      if (
        !info?.hasSelection ||
        !shell ||
        !domSelection ||
        domSelection.rangeCount === 0
      ) {
        setAnchor(null);
      } else {
        const rect = domSelection.getRangeAt(0).getBoundingClientRect();
        const shellRect = shell.getBoundingClientRect();
        setAnchor({
          top: rect.top - shellRect.top + shell.scrollTop,
          bottom: rect.bottom - shellRect.top + shell.scrollTop,
          left: rect.left - shellRect.left + shell.scrollLeft,
          width: rect.width,
        });
      }

      // A link created empty (by the link button) opens its input straight away.
      if (info && info.links.length === 1 && info.links[0].url === '') {
        editingKeyRef.current = info.links[0].key;
        setDraftUrl('');
        setEditing(true);
      }
    };

    // Docked visibility follows focus, not the pointer, so the drag-hide is
    // floating-only. iOS hands the touch to its own selection gesture partway
    // through, which ends the pointer stream with pointercancel rather than
    // pointerup — without that listener the flag latches on and every later
    // update() returns early, so the bar never reappears.
    const onPointerDown = (event: PointerEvent) => {
      if (docked || popoverRef.current?.contains(event.target as Node)) return;
      draggingRef.current = true;
      setAnchor(null);
    };
    const onPointerEnd = () => {
      draggingRef.current = false;
      update();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);

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
      editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          setFocused(true);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          setFocused(false);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      () => {
        document.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointerup', onPointerEnd);
        window.removeEventListener('pointercancel', onPointerEnd);
      },
    );
  }, [editor, docked]);

  useLayoutEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  // The gap the software keyboard leaves at the bottom of the layout viewport.
  // visualViewport is the only thing that reports it; without this the bar
  // would sit behind the keyboard rather than above it.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!docked || !viewport) return;
    const sync = () =>
      setKeyboardInset(
        Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop),
      );
    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
    };
  }, [docked]);

  // Centres the floating bar above the selection, clamped inside the shell
  // (which clips it — overflow-y: auto scrolls both axes) and flipped below
  // when the selection is too near the top. Re-runs on content changes since
  // the bar's measured width drives the clamp.
  useLayoutEffect(() => {
    const el = popoverRef.current;
    const shell = editor.getRootElement()?.parentElement;
    if (docked || !el || !shell || !anchor) return;
    const { width, height } = el.getBoundingClientRect();
    const centred = anchor.left + anchor.width / 2 - width / 2;
    const minLeft = shell.scrollLeft + SHELL_EDGE;
    const maxLeft = minLeft + shell.clientWidth - width - SHELL_EDGE * 2;
    const above = anchor.top - height - TOOLBAR_GAP;
    setPosition({
      left: Math.max(minLeft, Math.min(centred, maxLeft)),
      top:
        above >= shell.scrollTop + SHELL_EDGE
          ? above
          : anchor.bottom + TOOLBAR_GAP,
    });
  }, [anchor, editing, draftUrl, editor, docked]);

  const shown = state ?? EMPTY_STATE;
  const visible = docked ? focused || editing : anchor !== null;
  const shell = editor.getRootElement()?.parentElement;
  if (!visible || (!docked && !shell)) return null;

  // The URL is only shown (and editable) when the selection is about a single
  // link; touching several is still enough to unlink them all.
  const link = shown.links.length === 1 ? shown.links[0] : null;
  const hasLinks = shown.links.length > 0;

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
      removeLinks(shown.links.map((l) => l.key));
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

  const bar = (
    <div
      ref={barRef}
      className={
        docked
          ? `${styles.bar} ${styles.docked} ${keyboardInset ? styles.aboveKeyboard : ''}`
          : `${styles.bar} ${styles.floating}`
      }
      style={
        docked ? { bottom: keyboardInset } : { top: position.top, left: position.left }
      }
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
            const isActive = shown.formats.has(format);
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
                {...(docked
                  ? {
                      onTouchEnd: () =>
                        editor.dispatchCommand(FORMAT_TEXT_COMMAND, format),
                    }
                  : {
                      onMouseDown: preventDefault,
                      onClick: () =>
                        editor.dispatchCommand(FORMAT_TEXT_COMMAND, format),
                    })}
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
                {...(docked
                  ? { onTouchEnd: () => startEdit(link.key, link.url) }
                  : {
                      onMouseDown: preventDefault,
                      onClick: () => startEdit(link.key, link.url),
                    })}
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
            // Nothing to link at a collapsed cursor, which the docked bar can
            // sit at; the floating one only ever shows over a selection.
            disabled={!shown.hasSelection}
            {...(docked
              ? { onTouchEnd: toggleLink }
              : { onMouseDown: preventDefault, onClick: toggleLink })}
          >
            {hasLinks ? <Unlink size={16} /> : <Link size={16} />}
          </button>
        </>
      )}
    </div>
  );

  return createPortal(bar, docked ? document.body : shell!);
}
