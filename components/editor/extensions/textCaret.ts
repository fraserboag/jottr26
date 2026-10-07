import { Extension } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'

/** WebKit stretches its native caret to the line box on wrapped lines. Draw
 *  one at text height without changing the leading or putting a widget in
 *  the editable text, which could change wrapping and composition. */
export const TextCaret = Extension.create({
  name: 'textCaret',

  addProseMirrorPlugins() {
    return [new Plugin({
      view(view) {
        let host = view.dom.parentElement!
        const doc = view.dom.ownerDocument
        const win = doc.defaultView!
        const caret = doc.createElement('span')
        caret.className = 'text-caret'
        caret.setAttribute('aria-hidden', 'true')
        caret.hidden = true
        host.classList.add('editor-caret-host')
        host.appendChild(caret)
        let frame = 0

        function draw() {
          frame = 0
          // React's EditorContent moves the editor and its siblings into its
          // own container after the ProseMirror view has been constructed.
          const parent = view.dom.parentElement
          if (parent && parent !== host) {
            host.classList.remove('editor-caret-host')
            host = parent
            host.classList.add('editor-caret-host')
            host.appendChild(caret)
          }
          const { selection } = view.state
          // Inline code edges already draw their own caret. Leave composition
          // to the browser, including its IME caret and candidate positioning.
          const visible = view.hasFocus() && view.editable && !view.composing
            && selection instanceof TextSelection && selection.empty
            && !view.dom.classList.contains('on-code-edge')
          if (!visible) {
            caret.hidden = true
            return
          }

          const { node } = view.domAtPos(selection.head)
          const element = node.nodeType === 1 ? node as HTMLElement : node.parentElement!
          const style = win.getComputedStyle(element)
          let coords = view.coordsAtPos(selection.head)
          // At a soft wrap, one document position belongs to two visual
          // lines. The native range retains which side the user clicked or
          // reached with Home/End; coordsAtPos alone always chooses one side.
          const native = doc.getSelection()
          if (native?.isCollapsed && native.rangeCount && native.anchorNode
            && view.dom.contains(native.anchorNode)
            && view.posAtDOM(native.anchorNode, native.anchorOffset) === selection.head) {
            const rect = native.getRangeAt(0).getBoundingClientRect()
            // Empty blocks can report an empty rectangle at the page origin.
            if (rect.height > 0) coords = rect
          }
          // A caret in a horizontally scrolled table must stay clipped to
          // its viewport even though the overlay lives outside that table.
          for (let ancestor = element; ancestor && ancestor !== host; ancestor = ancestor.parentElement!) {
            const overflow = win.getComputedStyle(ancestor)
            const rect = ancestor.getBoundingClientRect()
            if ((/^(auto|scroll|hidden|clip)$/.test(overflow.overflowX)
              && (coords.left < rect.left || coords.left > rect.right))
              || (/^(auto|scroll|hidden|clip)$/.test(overflow.overflowY)
              && (coords.bottom < rect.top || coords.top > rect.bottom))) {
              caret.hidden = true
              return
            }
          }
          const bounds = host.getBoundingClientRect()
          // Coordinate rectangles include CSS transforms; convert back to the
          // host's local pixels so the caret follows zoomed/scaled text too.
          const scaleX = bounds.width / host.offsetWidth || 1
          const scaleY = bounds.height / host.offsetHeight || 1
          const lineHeight = (coords.bottom - coords.top) / scaleY
          const height = Math.min(lineHeight, parseFloat(style.fontSize) * 1.2)
          caret.style.left = `${(coords.left - bounds.left) / scaleX - host.clientLeft + host.scrollLeft}px`
          caret.style.top = `${(coords.top - bounds.top) / scaleY - host.clientTop + host.scrollTop + (lineHeight - height) / 2}px`
          caret.style.height = `${height}px`
          caret.hidden = false
        }

        function schedule() {
          if (!frame) frame = win.requestAnimationFrame(draw)
        }

        function restart() {
          for (const animation of caret.getAnimations()) animation.currentTime = 0
          schedule()
        }

        // The DOM selection can move at a wrap boundary without a transaction.
        // Focus and scroll also change the caret without editing the document.
        doc.addEventListener('selectionchange', restart)
        doc.addEventListener('scroll', schedule, true)
        view.dom.addEventListener('focus', restart)
        view.dom.addEventListener('blur', schedule)
        view.dom.addEventListener('compositionstart', schedule)
        view.dom.addEventListener('compositionend', schedule)
        win.addEventListener('resize', schedule)
        const resize = new win.ResizeObserver(schedule)
        resize.observe(view.dom)
        schedule()

        return {
          update: restart,
          destroy() {
            win.cancelAnimationFrame(frame)
            resize.disconnect()
            doc.removeEventListener('selectionchange', restart)
            doc.removeEventListener('scroll', schedule, true)
            view.dom.removeEventListener('focus', restart)
            view.dom.removeEventListener('blur', schedule)
            view.dom.removeEventListener('compositionstart', schedule)
            view.dom.removeEventListener('compositionend', schedule)
            win.removeEventListener('resize', schedule)
            caret.remove()
            host.classList.remove('editor-caret-host')
          },
        }
      },
    })]
  },
})
