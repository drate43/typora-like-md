import { convertFileSrc } from '@tauri-apps/api/core'
import { imageSchema } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { $ctx, $view } from '@milkdown/kit/utils'

export const documentDirectoryCtx = $ctx('', 'documentDirectory')

function isTauriRuntime() {
  return Boolean((window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

function normalizePath(path: string) {
  const prefix = path.startsWith('/') ? '/' : ''
  const pieces = path.replaceAll('\\', '/').split('/')
  const output: string[] = []
  for (const piece of pieces) {
    if (!piece || piece === '.') continue
    if (piece === '..') output.pop()
    else output.push(piece)
  }
  return prefix + output.join('/')
}

function resolveImageSource(source: string, directory: string) {
  if (!source) return ''
  if (/^(https?:|data:|blob:|asset:|tauri:)/i.test(source)) return source

  const filePath = source.startsWith('file://')
    ? decodeURIComponent(source.slice('file://'.length))
    : source

  if (!isTauriRuntime()) return source

  const absolute = filePath.startsWith('/')
    ? normalizePath(filePath)
    : normalizePath(`${directory}/${filePath}`)

  return convertFileSrc(absolute)
}

class ImageNodeView implements NodeView {
  dom: HTMLElement

  private node: ProseNode
  private view: EditorView
  private getPos: () => number | undefined
  private image: HTMLImageElement
  private fallback: HTMLSpanElement
  private getDirectory: () => string

  constructor(
    node: ProseNode,
    view: EditorView,
    getPos: () => number | undefined,
    getDirectory: () => string
  ) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.getDirectory = getDirectory

    const shell = document.createElement('span')
    shell.className = 'inline-image-node'
    shell.contentEditable = 'false'

    this.image = document.createElement('img')
    this.image.draggable = true

    this.fallback = document.createElement('span')
    this.fallback.className = 'image-fallback'

    shell.append(this.image, this.fallback)
    shell.addEventListener('dblclick', this.editSource)

    this.image.addEventListener('load', this.onLoad)
    this.image.addEventListener('error', this.onError)

    this.dom = shell
    this.render()
  }

  private onLoad = () => {
    this.dom.classList.remove('is-broken')
  }

  private onError = () => {
    this.dom.classList.add('is-broken')
    this.fallback.textContent = `이미지를 불러올 수 없음: ${String(this.node.attrs.src ?? '')}`
  }

  private editSource = (event: MouseEvent) => {
    event.preventDefault()
    const current = String(this.node.attrs.src ?? '')
    const next = window.prompt('이미지 경로 또는 URL', current)
    if (next === null || next === current) return

    const pos = this.getPos()
    if (typeof pos !== 'number') return

    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        src: next,
      })
    )
  }

  private render() {
    const source = String(this.node.attrs.src ?? '')
    const alt = String(this.node.attrs.alt ?? '')
    const title = String(this.node.attrs.title ?? '')
    this.image.alt = alt
    this.image.title = title || alt
    this.image.src = resolveImageSource(source, this.getDirectory())
    this.fallback.textContent = `이미지를 불러올 수 없음: ${source}`
  }

  update(node: ProseNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  stopEvent(event: Event) {
    return event.type === 'dblclick'
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    this.dom.removeEventListener('dblclick', this.editSource)
    this.image.removeEventListener('load', this.onLoad)
    this.image.removeEventListener('error', this.onError)
  }
}

export const imageView = $view(imageSchema.node, (ctx) => {
  return (node, view, getPos) =>
    new ImageNodeView(node, view, getPos, () => ctx.get(documentDirectoryCtx.key))
})
