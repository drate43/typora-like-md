import DOMPurify from 'dompurify'
import mermaid from 'mermaid'
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type {
  EditorView,
  NodeView,
  NodeViewConstructor,
  ViewMutationRecord,
} from '@milkdown/kit/prose/view'
import { $view } from '@milkdown/kit/utils'

let renderSequence = 0
const mermaidFontFamily =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif'

function isMermaid(node: ProseNode) {
  return String(node.attrs.language ?? '').trim().toLowerCase() === 'mermaid'
}

function languageLabel(node: ProseNode) {
  const value = String(node.attrs.language ?? '').trim()
  return value || 'text'
}

export function initializeMermaid() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    htmlLabels: false,
    fontFamily: mermaidFontFamily,
    flowchart: {
      useMaxWidth: true,
      curve: 'basis',
    },
    sequence: {
      useMaxWidth: true,
    },
    gantt: {
      useMaxWidth: true,
    },
    journey: {
      useMaxWidth: true,
    },
  })
}

function sanitizeMermaidSvg(svg: string) {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    ADD_ATTR: [
      'dominant-baseline',
      'marker-end',
      'marker-mid',
      'marker-start',
      'text-anchor',
      'viewBox',
    ],
  })
}

class CodeBlockNodeView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement

  private node: ProseNode
  private view: EditorView
  private getPos: () => number | undefined
  private preview: HTMLDivElement | null = null
  private sourceArea: HTMLPreElement
  private label: HTMLSpanElement
  private renderTimer: number | null = null
  private renderToken = 0
  private mode: 'mermaid' | 'code'

  constructor(
    node: ProseNode,
    view: EditorView,
    getPos: () => number | undefined
  ) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.mode = isMermaid(node) ? 'mermaid' : 'code'

    const shell = document.createElement('div')
    shell.className = `md-code-block ${
      this.mode === 'mermaid' ? 'mermaid-code-block' : 'plain-code-block'
    }`
    shell.dataset.language = languageLabel(node)

    const header = document.createElement('div')
    header.className = 'code-block-header'
    header.contentEditable = 'false'

    this.label = document.createElement('span')
    this.label.className = 'code-language-label'
    this.label.textContent = languageLabel(node)
    header.append(this.label)

    const hint = document.createElement('span')
    hint.className = 'code-block-hint'
    hint.textContent = this.mode === 'mermaid' ? '클릭하여 다이어그램 소스 편집' : ''
    header.append(hint)

    this.sourceArea = document.createElement('pre')
    this.sourceArea.className = 'code-source'

    const code = document.createElement('code')
    code.spellcheck = false
    code.dataset.language = languageLabel(node)
    this.sourceArea.append(code)
    this.contentDOM = code

    shell.append(header)

    if (this.mode === 'mermaid') {
      this.preview = document.createElement('div')
      this.preview.className = 'mermaid-preview'
      this.preview.contentEditable = 'false'
      this.preview.setAttribute('role', 'button')
      this.preview.setAttribute('aria-label', 'Mermaid 다이어그램. 클릭하면 소스를 편집합니다.')
      this.preview.tabIndex = 0
      this.preview.addEventListener('mousedown', this.openEditor)
      this.preview.addEventListener('keydown', this.onPreviewKeyDown)
      shell.append(this.preview)
    }

    shell.append(this.sourceArea)
    shell.addEventListener('keydown', this.onShellKeyDown)
    shell.addEventListener('beforeinput', this.onShellBeforeInput)
    if (this.mode === 'mermaid') {
      document.addEventListener('pointerdown', this.onDocumentPointerDown, true)
    }

    this.dom = shell
    this.scheduleRender()
  }

  private openEditor = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    this.dom.classList.add('is-editing')

    const pos = this.getPos()
    if (typeof pos !== 'number') return

    const resolved = this.view.state.doc.resolve(
      Math.min(pos + 1, this.view.state.doc.content.size)
    )
    this.view.dispatch(
      this.view.state.tr
        .setSelection(TextSelection.near(resolved, 1))
        .scrollIntoView()
    )
    this.view.focus()
  }

  private onPreviewKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') this.openEditor(event)
  }

  private isSourceEventTarget(target: EventTarget | null) {
    return target instanceof globalThis.Node && this.contentDOM.contains(target)
  }

  private insertMermaidNewline() {
    if (this.mode !== 'mermaid') return false

    const { selection } = this.view.state
    if (!(selection instanceof TextSelection)) return false
    if (!selection.$from.sameParent(selection.$to)) return false
    if (!selection.$from.parent.type.spec.code) return false

    this.view.dispatch(
      this.view.state.tr
        .insertText('\n', selection.from, selection.to)
        .scrollIntoView()
    )
    this.view.focus()
    return true
  }

  private onShellBeforeInput = (event: InputEvent) => {
    if (!this.isSourceEventTarget(event.target)) return
    if (event.isComposing) return
    if (event.inputType !== 'insertParagraph' && event.inputType !== 'insertLineBreak') {
      return
    }

    if (this.insertMermaidNewline()) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  private onShellKeyDown = (event: KeyboardEvent) => {
    if (
      event.key === 'Enter' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.isComposing &&
      this.isSourceEventTarget(event.target) &&
      this.insertMermaidNewline()
    ) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (event.key === 'Escape' && this.mode === 'mermaid') {
      this.dom.classList.remove('is-editing')
      this.preview?.focus()
    }
  }

  private onDocumentPointerDown = (event: PointerEvent) => {
    if (!this.dom.contains(event.target as globalThis.Node)) {
      this.dom.classList.remove('is-editing')
    }
  }

  private scheduleRender() {
    if (this.mode !== 'mermaid' || !this.preview) return
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer)
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null
      void this.renderMermaid()
    }, 180)
  }

  private async renderMermaid() {
    if (!this.preview) return
    const source = this.node.textContent.trim()
    const token = ++this.renderToken

    if (!source) {
      this.preview.innerHTML = '<span class="mermaid-empty">Mermaid 소스를 입력하세요.</span>'
      this.preview.classList.remove('has-error')
      return
    }

    try {
      const id = `mermaid-${Date.now()}-${renderSequence++}`
      const { svg } = await mermaid.render(id, source)
      if (token !== this.renderToken || !this.preview) return
      this.preview.innerHTML = sanitizeMermaidSvg(svg)
      this.preview.classList.remove('has-error')
    } catch (error) {
      if (token !== this.renderToken || !this.preview) return
      const message = error instanceof Error ? error.message : String(error)
      this.preview.textContent = `Mermaid 오류: ${message}`
      this.preview.classList.add('has-error')
    }
  }

  update(node: ProseNode) {
    if (node.type !== this.node.type) return false
    if (isMermaid(node) !== (this.mode === 'mermaid')) return false

    this.node = node
    this.label.textContent = languageLabel(node)
    this.contentDOM.dataset.language = languageLabel(node)
    this.dom.dataset.language = languageLabel(node)
    this.scheduleRender()
    return true
  }

  setSelection() {
    if (this.mode === 'mermaid') this.dom.classList.add('is-editing')
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    const target = mutation.target as globalThis.Node
    if (this.preview?.contains(target) || this.preview === target) return true
    if (!this.contentDOM.contains(target) && this.contentDOM !== target) return true
    return false
  }

  stopEvent(event: Event) {
    return Boolean(this.preview?.contains(event.target as globalThis.Node))
  }

  destroy() {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer)
    this.renderToken += 1
    this.preview?.removeEventListener('mousedown', this.openEditor)
    this.preview?.removeEventListener('keydown', this.onPreviewKeyDown)
    this.dom.removeEventListener('keydown', this.onShellKeyDown)
    this.dom.removeEventListener('beforeinput', this.onShellBeforeInput)
    if (this.mode === 'mermaid') {
      document.removeEventListener('pointerdown', this.onDocumentPointerDown, true)
    }
  }
}

export const codeBlockView = $view(codeBlockSchema.node, () => {
  return ((
    node: ProseNode,
    view: EditorView,
    getPos: () => number | undefined
  ) =>
    isMermaid(node)
      ? new CodeBlockNodeView(node, view, getPos)
      : undefined) as unknown as NodeViewConstructor
})
