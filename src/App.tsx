import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Editor } from '@milkdown/kit/core'
import {
  defaultValueCtx,
  editorViewCtx,
  parserCtx,
  rootCtx,
} from '@milkdown/kit/core'
import {
  codeBlockAttr,
  commonmark,
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import {
  addColAfterCommand,
  addRowAfterCommand,
  deleteSelectedCellsCommand,
  gfm,
  insertTableCommand,
  setAlignCommand,
  toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import {
  history,
  redoCommand,
  undoCommand,
} from '@milkdown/kit/plugin/history'
import { indent } from '@milkdown/kit/plugin/indent'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { trailing } from '@milkdown/kit/plugin/trailing'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Selection,
} from '@milkdown/kit/prose/state'
import { findTable, selectedRect } from '@milkdown/kit/prose/tables'
import {
  Decoration,
  DecorationSet,
} from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  $prose,
  callCommand,
  forceUpdate,
  getMarkdown,
  insert,
  replaceAll,
} from '@milkdown/kit/utils'
import { Editor as MilkdownEditor } from '@milkdown/kit/core'
import { katexOptionsCtx, math } from '@milkdown/plugin-math'
import { codeBlockView, initializeMermaid } from './editor/mermaid-code-view'
import {
  codeSyntaxHighlighting,
  highlightCodeRanges,
  type HighlightRange,
} from './editor/code-highlight'
import {
  documentDirectoryCtx,
  imageView,
} from './editor/image-view'
import { frontmatter } from './editor/frontmatter'
import { WorkspaceSidebar } from './components/WorkspaceSidebar'
import type {
  RecentDocument,
  SearchMatch,
  SidebarTab,
  WorkspaceNode,
  WorkspaceSnapshot,
} from './workspace-types'

const DEFAULT_MD = '# 제목 없음\n\n'

const NEW_DOCUMENT = DEFAULT_MD
const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd']
const TEXT_EXTENSIONS = [
  'txt',
  'json',
  'yaml',
  'yml',
  'toml',
  'csv',
  'log',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'css',
  'html',
  'htm',
  'xml',
  'svg',
  'vue',
  'svelte',
  'py',
  'sql',
  'sh',
  'bash',
  'zsh',
  'diff',
  'patch',
  'ini',
  'conf',
]
const OPENABLE_EXTENSIONS = [...MARKDOWN_EXTENSIONS, ...TEXT_EXTENSIONS]
const OPENABLE_EXTENSION_ACCEPT = OPENABLE_EXTENSIONS.map((extension) => `.${extension}`).join(',')
const RECENT_DOCUMENTS_KEY = 'markflow.recent-documents.v1'
const WORKSPACE_ROOT_KEY = 'markflow.workspace-root.v1'
const THEME_MODE_KEY = 'markflow.theme-mode.v1'
const FORMATBAR_VISIBLE_KEY = 'markflow.formatbar-visible.v1'
const VIEW_DENSITY_KEY = 'markflow.view-density.v1'
const NAVIGATION_OPEN_KEY = 'markflow.navigation-open.v1'
const SIDEBAR_TAB_KEY = 'markflow.sidebar-tab.v1'
const NAVIGATION_WIDTH_KEY = 'markflow.navigation-width.v1'
const OUTLINE_WIDTH_KEY = 'markflow.outline-width.v1'
const SOURCE_SPLIT_KEY = 'markflow.source-split-percent.v1'
const CMUX_PANE_SPLIT_KEY = 'markflow.cmux-pane-split-percent.v1'
const MAX_RECENT_DOCUMENTS = 20
const DEFAULT_NAVIGATION_WIDTH = 286
const MIN_NAVIGATION_WIDTH = 220
const MAX_NAVIGATION_WIDTH = 440
const DEFAULT_OUTLINE_WIDTH = 286
const MIN_OUTLINE_WIDTH = 220
const MAX_OUTLINE_WIDTH = 460
const DEFAULT_SOURCE_SPLIT = 52
const MIN_SOURCE_SPLIT = 32
const MAX_SOURCE_SPLIT = 72
const DEFAULT_CMUX_PANE_SPLIT = 58
const MIN_CMUX_PANE_SPLIT = 38
const MAX_CMUX_PANE_SPLIT = 72
const MAX_SOURCE_HIGHLIGHT_LENGTH = 50_000
const SOURCE_HIGHLIGHT_DELAY_MS = 120
const MAX_DETAILED_STATS_LENGTH = 300_000
const FILE_CHANGE_CHECK_INTERVAL_MS = 3500

const THEME_OPTIONS = [
  { value: 'default-light', label: '기본 라이트' },
  { value: 'typora-light', label: 'Typora 라이트' },
  { value: 'soft-light', label: '소프트 라이트' },
  { value: 'default-dark', label: '기본 다크' },
  { value: 'darcula', label: 'Darcula' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'nord', label: 'Nord' },
  { value: 'tokyo-night', label: 'Tokyo Night' },
  { value: 'webstorm-new-dark', label: 'WebStorm New Dark' },
  { value: 'vscode-dark', label: 'VS Code Dark' },
  { value: 'vscode-dark-modern', label: 'VS Code Dark Modern' },
  { value: 'one-dark-pro', label: 'One Dark Pro' },
  { value: 'catppuccin-mocha', label: 'Catppuccin Mocha' },
  { value: 'gruvbox-dark', label: 'Gruvbox Dark' },
  { value: 'solarized-dark', label: 'Solarized Dark' },
] as const

type ThemeMode = (typeof THEME_OPTIONS)[number]['value']
type ViewDensity = 'normal' | 'compact'

type OpenTarget = {
  path: string
  kind: 'file' | 'directory'
}

type DocumentMetadata = {
  path: string
  modifiedMs: number
  len: number
}

const SOURCE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  mkd: 'markdown',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  css: 'css',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  svelte: 'xml',
  py: 'python',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  diff: 'diff',
  patch: 'diff',
  ini: 'ini',
  conf: 'ini',
}
const CODE_LANGUAGE_OPTIONS = [
  { value: '', label: '자동' },
  { value: 'text', label: 'Text' },
  { value: 'bash', label: 'Bash' },
  { value: 'css', label: 'CSS' },
  { value: 'diff', label: 'Diff' },
  { value: 'html', label: 'HTML' },
  { value: 'ini', label: 'INI' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'python', label: 'Python' },
  { value: 'sql', label: 'SQL' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'tsx', label: 'TSX' },
  { value: 'xml', label: 'XML' },
  { value: 'yaml', label: 'YAML' },
  { value: 'mermaid', label: 'Mermaid' },
]

function getDocumentExtension(path: string) {
  const cleanPath = path.split(/[?#]/, 1)[0]
  return cleanPath.split('.').at(-1)?.toLowerCase() ?? ''
}

function isSupportedDocumentPath(path: string) {
  return OPENABLE_EXTENSIONS.includes(getDocumentExtension(path))
}

function isMarkdownDocumentPath(path: string) {
  return MARKDOWN_EXTENSIONS.includes(getDocumentExtension(path))
}

function getSourceLanguage(path: string) {
  return SOURCE_LANGUAGE_BY_EXTENSION[getDocumentExtension(path)] ?? ''
}

function renderHighlightedSource(text: string, ranges: HighlightRange[]) {
  if (!text || ranges.length === 0) return text

  const nodes: React.ReactNode[] = []
  let cursor = 0

  ranges.forEach((range, index) => {
    const from = Math.max(cursor, Math.min(text.length, range.from))
    const to = Math.max(from, Math.min(text.length, range.to))
    if (from > cursor) nodes.push(text.slice(cursor, from))
    if (to > from) {
      nodes.push(
        <span key={`${from}-${to}-${index}`} className={range.className}>
          {text.slice(from, to)}
        </span>
      )
    }
    cursor = to
  })

  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

type BrowserFileHandle = {
  name?: string
  getFile: () => Promise<File>
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>
    close: () => Promise<void>
  }>
}

type BrowserDroppedFile = File & {
  path?: unknown
}

type MainDocumentTab = {
  id: string
  path: string | null
  name: string
  text: string
  savedText: string
  dirty: boolean
  browserHandle?: BrowserFileHandle | null
  metadata?: DocumentMetadata | null
}

type LoadDocumentOptions = {
  tauriPath?: string | null
  browserHandle?: BrowserFileHandle | null
  name: string
  metadata?: DocumentMetadata | null
  tabId?: string | null
  savedText?: string
  dirty?: boolean
}

type PendingDocument = {
  text: string
  options: LoadDocumentOptions
}

type PaneDocument = {
  path: string
  name: string
  text: string
  savedText: string
  dirty: boolean
  openedAt: number
  metadata?: DocumentMetadata | null
}

type SourceHighlightState = {
  text: string
  language: string
  ranges: HighlightRange[]
}

type TauriModules = {
  open: typeof import('@tauri-apps/plugin-dialog').open
  save: typeof import('@tauri-apps/plugin-dialog').save
}

type OutlineItem = {
  level: number
  text: string
  pos: number
}

type TableToolbarState = {
  left: number
  top: number
}

const INITIAL_MAIN_TAB: MainDocumentTab = {
  id: 'main-tab-initial',
  path: null,
  name: '제목 없음.md',
  text: NEW_DOCUMENT,
  savedText: NEW_DOCUMENT,
  dirty: false,
  browserHandle: null,
  metadata: null,
}

type TextMatch = {
  from: number
  to: number
}

type DocumentSearchDecorationState = {
  query: string
  activeIndex: number
}

const documentSearchDecorationsKey = new PluginKey<DocumentSearchDecorationState>(
  'MARKVIEW_DOCUMENT_SEARCH_DECORATIONS'
)

function isTauriRuntime() {
  return Boolean((window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

async function getTauriModules(): Promise<TauriModules | null> {
  if (!isTauriRuntime()) return null
  const dialog = await import('@tauri-apps/plugin-dialog')
  return {
    open: dialog.open,
    save: dialog.save,
  }
}

function basename(path: string) {
  const pieces = path.replaceAll('\\', '/').split('/')
  return pieces.at(-1) || '제목 없음.md'
}

function droppedFilePath(file: File) {
  const path = (file as BrowserDroppedFile).path
  return typeof path === 'string' && path ? path : null
}

function dirname(path: string) {
  const normalized = path.replaceAll('\\', '/')
  const pieces = normalized.split('/')
  pieces.pop()
  return pieces.join('/') || '/'
}

function normalizedPath(path: string) {
  return path.replaceAll('\\', '/').replace(/\/+$/, '')
}

function isPathInsideRoot(path: string, root: string) {
  const normalizedFile = normalizedPath(path)
  const normalizedRoot = normalizedPath(root)
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`)
}

function ancestorDirectories(path: string, root: string) {
  const normalizedRoot = normalizedPath(root)
  const ancestors: string[] = []
  let current = normalizedPath(dirname(path))

  while (current && current !== normalizedRoot && isPathInsideRoot(current, normalizedRoot)) {
    ancestors.push(current)
    const parent = normalizedPath(dirname(current))
    if (!parent || parent === current) break
    current = parent
  }

  return ancestors
}

function collectDirectoryPaths(entries: WorkspaceNode[], result = new Set<string>()) {
  for (const entry of entries) {
    if (!entry.isDirectory) continue
    result.add(entry.path)
    collectDirectoryPaths(entry.children, result)
  }
  return result
}

function readRecentDocuments(): RecentDocument[] {
  try {
    const saved = window.localStorage.getItem(RECENT_DOCUMENTS_KEY)
    if (!saved) return []
    const parsed = JSON.parse(saved) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((value): value is RecentDocument => {
        if (!value || typeof value !== 'object') return false
        const candidate = value as Partial<RecentDocument>
        return (
          typeof candidate.path === 'string' &&
          typeof candidate.name === 'string' &&
          typeof candidate.openedAt === 'number'
        )
      })
      .slice(0, MAX_RECENT_DOCUMENTS)
  } catch {
    return []
  }
}

function readThemeMode(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_MODE_KEY)
    if (saved === 'light') return 'default-light'
    if (saved === 'dark') return 'default-dark'
    if (saved === 'dracula' || saved?.startsWith('dracula-')) return 'dracula'
    if (THEME_OPTIONS.some((option) => option.value === saved)) return saved as ThemeMode
  } catch {
    // 저장된 테마를 읽지 못해도 기본 라이트 테마로 시작합니다.
  }
  return 'default-light'
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function readFormatbarVisible() {
  try {
    return window.localStorage.getItem(FORMATBAR_VISIBLE_KEY) !== '0'
  } catch {
    return true
  }
}

function readViewDensity(): ViewDensity {
  try {
    const saved = window.localStorage.getItem(VIEW_DENSITY_KEY)
    if (saved === 'compact' || saved === 'normal') return saved
  } catch {
    // 보기 간격 저장값을 읽지 못하면 보통 간격으로 시작합니다.
  }
  return 'normal'
}

function readNavigationOpen() {
  try {
    const saved = window.localStorage.getItem(NAVIGATION_OPEN_KEY)
    if (saved === null) return true
    return saved !== '0'
  } catch {
    return true
  }
}

function readSidebarTab(): SidebarTab {
  try {
    const saved = window.localStorage.getItem(SIDEBAR_TAB_KEY)
    if (saved === 'files' || saved === 'recent' || saved === 'search') return saved
  } catch {
    // 탐색 탭 저장값을 읽지 못하면 파일 탭으로 시작합니다.
  }
  return 'files'
}

function readStoredNumber(key: string, fallback: number, min: number, max: number) {
  try {
    const saved = Number(window.localStorage.getItem(key))
    if (Number.isFinite(saved)) return clampNumber(saved, min, max)
  } catch {
    // 저장된 레이아웃 값을 읽지 못하면 기본값으로 표시합니다.
  }
  return fallback
}

function readNavigationWidth() {
  return readStoredNumber(
    NAVIGATION_WIDTH_KEY,
    DEFAULT_NAVIGATION_WIDTH,
    MIN_NAVIGATION_WIDTH,
    MAX_NAVIGATION_WIDTH
  )
}

function readOutlineWidth() {
  return readStoredNumber(
    OUTLINE_WIDTH_KEY,
    DEFAULT_OUTLINE_WIDTH,
    MIN_OUTLINE_WIDTH,
    MAX_OUTLINE_WIDTH
  )
}

function readSourceSplitPercent() {
  return readStoredNumber(
    SOURCE_SPLIT_KEY,
    DEFAULT_SOURCE_SPLIT,
    MIN_SOURCE_SPLIT,
    MAX_SOURCE_SPLIT
  )
}

function readCmuxPaneSplitPercent() {
  return readStoredNumber(
    CMUX_PANE_SPLIT_KEY,
    DEFAULT_CMUX_PANE_SPLIT,
    MIN_CMUX_PANE_SPLIT,
    MAX_CMUX_PANE_SPLIT
  )
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>) {
  if (!isTauriRuntime()) throw new Error('이 기능은 macOS 앱에서 사용할 수 있습니다.')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

function describeError(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // WebView별 권한 차이가 있어 DOM 복사 방식으로 한 번 더 시도합니다.
    }
  }

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.readOnly = true
  textArea.style.position = 'fixed'
  textArea.style.top = '-9999px'
  textArea.style.left = '-9999px'
  document.body.append(textArea)
  textArea.focus()
  textArea.select()

  try {
    if (!document.execCommand('copy')) {
      throw new Error('클립보드에 복사할 수 없습니다.')
    }
  } finally {
    textArea.remove()
  }
}

function normalizeExternalLink(href: string) {
  const trimmed = href.trim()
  if (!/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return null

  try {
    const url = new URL(trimmed)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

async function openExternalLink(href: string) {
  const url = normalizeExternalLink(href)
  if (!url) return

  if (isTauriRuntime()) {
    await invokeTauri<void>('open_external_url', { url })
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

async function writeDebugLog(message: string) {
  console.debug(`[Markview] ${message}`)
  if (!isTauriRuntime()) return

  try {
    await invokeTauri<void>('log_debug_message', { message })
  } catch {
    // 파일 열기 진단 로그가 실패해도 사용자 동작은 계속 진행합니다.
  }
}

function collectOutline(doc: ProseNode): OutlineItem[] {
  const items: OutlineItem[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      items.push({
        level: Number(node.attrs.level || 1),
        text: node.textContent || '제목 없음',
        pos,
      })
    }
  })
  return items
}

function areOutlinesEqual(left: OutlineItem[], right: OutlineItem[]) {
  if (left.length !== right.length) return false
  return left.every((item, index) => {
    const other = right[index]
    return (
      item.level === other.level &&
      item.text === other.text &&
      item.pos === other.pos
    )
  })
}

function countDocument(markdown: string) {
  if (markdown.length > MAX_DETAILED_STATS_LENGTH) {
    return countLargeDocument(markdown)
  }

  const plain = markdown
    .replace(/^---\n[\s\S]*?\n---\n?/m, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[#>*_~|$-]+/g, ' ')

  const words = plain.match(/[A-Za-z0-9_]+|[가-힣]+/g)?.length ?? 0
  const characters = Array.from(plain.replace(/\s/g, '')).length
  const lines = markdown.length === 0 ? 0 : markdown.split(/\r?\n/).length
  const minutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / 240))
  return { words, characters, lines, minutes }
}

function countLargeDocument(markdown: string) {
  let words = 0
  let characters = 0
  let lines = markdown.length === 0 ? 0 : 1
  let inWord = false

  for (const character of markdown) {
    const code = character.codePointAt(0) ?? 0
    const whitespace =
      code === 9 ||
      code === 10 ||
      code === 11 ||
      code === 12 ||
      code === 13 ||
      code === 32 ||
      code === 160

    if (code === 10) lines += 1
    if (!whitespace) characters += 1

    const wordCharacter =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 95 ||
      (code >= 0xac00 && code <= 0xd7a3)

    if (wordCharacter) {
      if (!inWord) words += 1
      inWord = true
    } else {
      inWord = false
    }
  }

  const minutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / 240))
  return { words, characters, lines, minutes }
}

function findTextMatches(text: string, query: string): TextMatch[] {
  const needle = query.trim()
  if (!needle) return []

  const matches: TextMatch[] = []
  const lowerText = text.toLocaleLowerCase()
  const lowerNeedle = needle.toLocaleLowerCase()
  let index = lowerText.indexOf(lowerNeedle)

  while (index >= 0) {
    matches.push({ from: index, to: index + needle.length })
    index = lowerText.indexOf(lowerNeedle, index + needle.length)
  }

  return matches
}

function findDocumentMatches(doc: ProseNode, query: string): TextMatch[] {
  const needle = query.trim()
  if (!needle) return []

  const matches: TextMatch[] = []
  const lowerNeedle = needle.toLocaleLowerCase()

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return

    const lowerText = node.text.toLocaleLowerCase()
    let index = lowerText.indexOf(lowerNeedle)

    while (index >= 0) {
      matches.push({ from: pos + index, to: pos + index + needle.length })
      index = lowerText.indexOf(lowerNeedle, index + needle.length)
    }
  })

  return matches
}

const documentSearchDecorations = $prose(() => new Plugin<DocumentSearchDecorationState>({
  key: documentSearchDecorationsKey,
  state: {
    init: () => ({ query: '', activeIndex: 0 }),
    apply: (tr, value) => {
      const meta = tr.getMeta(documentSearchDecorationsKey) as DocumentSearchDecorationState | undefined
      return meta ?? value
    },
  },
  props: {
    decorations: (state) => {
      const searchState = documentSearchDecorationsKey.getState(state)
      if (!searchState?.query.trim()) return DecorationSet.empty

      const matches = findDocumentMatches(state.doc, searchState.query)
      if (matches.length === 0) return DecorationSet.empty

      const activeIndex = Math.max(
        0,
        Math.min(searchState.activeIndex, matches.length - 1)
      )
      return DecorationSet.create(
        state.doc,
        matches.map((match, index) =>
          Decoration.inline(match.from, match.to, {
            class: `document-search-hit${index === activeIndex ? ' is-current' : ''}`,
          })
        )
      )
    },
  },
}))

const codeBlockEnterGuard = $prose(() => new Plugin({
  props: {
    handleDOMEvents: {
      beforeinput: (view, event) => {
        if (!(event instanceof InputEvent)) return false
        if (
          event.inputType !== 'insertParagraph' &&
          event.inputType !== 'insertLineBreak'
        ) {
          return false
        }
        const selection = getCodeBlockTextSelection(view)
        if (!selection || !event.cancelable) return false

        event.preventDefault()
        insertCodeBlockNewline(view, selection)
        return true
      },
    },
    handleKeyDown: (view, event) => {
      if (event.key !== 'Enter') return false
      if (event.metaKey || event.ctrlKey || event.altKey) return false
      if (view.composing || event.isComposing) return false
      const selection = getCodeBlockTextSelection(view)
      if (!selection) return false

      event.preventDefault()
      insertCodeBlockNewline(view, selection)
      return true
    },
  },
}))

const tableCellEnterGuard = $prose(() => new Plugin({
  props: {
    handleDOMEvents: {
      beforeinput: (view, event) => {
        if (!(event instanceof InputEvent)) return false
        if (
          event.inputType !== 'insertParagraph' &&
          event.inputType !== 'insertLineBreak'
        ) {
          return false
        }
        if (!event.cancelable || !isTableCellTextSelection(view)) return false

        event.preventDefault()
        handleTableCellEnter(view)
        return true
      },
    },
    handleKeyDown: (view, event) => {
      if (event.key !== 'Enter') return false
      if (event.metaKey || event.ctrlKey || event.altKey) return false
      if (view.composing || event.isComposing) return false
      if (!isTableCellTextSelection(view)) return false

      event.preventDefault()
      handleTableCellEnter(view)
      return true
    },
  },
}))

const externalLinkOpenHandler = $prose(() => new Plugin({
  props: {
    handleDOMEvents: {
      click: (_view, event) => {
        if (!(event instanceof MouseEvent)) return false
        if (!event.metaKey) return false

        const target = event.target instanceof Element ? event.target : null
        const anchor = target?.closest('a[href]')
        if (!(anchor instanceof HTMLAnchorElement)) return false

        const href = anchor.getAttribute('href') ?? ''
        if (!normalizeExternalLink(href)) return false

        event.preventDefault()
        event.stopPropagation()
        void openExternalLink(href)
        return true
      },
    },
  },
}))

function getCodeBlockTextSelection(view: EditorView) {
  const { selection } = view.state
  return getCodeBlockTextSelectionFromSelection(selection)
}

function getCodeBlockTextSelectionFromSelection(selection: Selection) {
  if (!(selection instanceof TextSelection)) return null

  const { $from, $to } = selection
  if (!$from.sameParent($to)) return null
  if (!$from.parent.type.spec.code || !$to.parent.type.spec.code) return null

  return selection
}

function getCodeBlockSelectionInfo(selection: Selection) {
  const textSelection = getCodeBlockTextSelectionFromSelection(selection)
  if (!textSelection) return null

  const { $from } = textSelection
  return {
    pos: $from.before($from.depth),
    language: String($from.parent.attrs.language ?? '').trim().toLowerCase(),
  }
}

function insertCodeBlockNewline(view: EditorView, selection: TextSelection) {
  view.dispatch(
    view.state.tr
      .insertText('\n', selection.from, selection.to)
      .scrollIntoView()
  )
}

const TABLE_CELL_NODE_NAMES = new Set(['table_cell', 'table_header'])

function isTableCellTextSelection(view: EditorView) {
  return getTableCellTextSelection(view) !== null
}

function getTableCellTextSelection(view: EditorView) {
  const { selection } = view.state
  if (!(selection instanceof TextSelection)) return null

  const { $from, $to } = selection
  let cellDepth = -1
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if (TABLE_CELL_NODE_NAMES.has($from.node(depth).type.name)) {
      cellDepth = depth
      break
    }
  }
  if (cellDepth < 1) return null
  if ($from.before(cellDepth) !== $to.before(cellDepth)) return null

  return selection
}

function handleTableCellEnter(view: EditorView) {
  const selection = getTableCellTextSelection(view)
  if (!selection) return false
  const hardbreakType = view.state.schema.nodes.hardbreak
  const tr = hardbreakType
    ? view.state.tr.replaceSelectionWith(hardbreakType.create())
    : view.state.tr.insertText('\n', selection.from, selection.to)
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

function getSourceOffsetFromRenderedTextSelection(
  selection: TextSelection,
  doc: ProseNode,
  markdown: string
) {
  const estimatedOffset = markdown.length > 0
    ? Math.round((selection.from / Math.max(1, doc.content.size)) * markdown.length)
    : 0
  const beforeText = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '\n', '\n')
  const afterText = selection.$from.parent.textBetween(selection.$from.parentOffset, selection.$from.parent.content.size, '\n', '\n')
  const parentText = `${beforeText}${afterText}`

  if (parentText) {
    const parentIndex = findClosestTextIndex(markdown, parentText, estimatedOffset)
    if (parentIndex >= 0) return clampTextOffset(markdown, parentIndex + beforeText.length)
  }

  const beforeNeedle = beforeText.slice(-80)
  if (beforeNeedle) {
    const beforeIndex = findClosestTextIndex(markdown, beforeNeedle, estimatedOffset)
    if (beforeIndex >= 0) return clampTextOffset(markdown, beforeIndex + beforeNeedle.length)
  }

  const afterNeedle = afterText.slice(0, 80)
  if (afterNeedle) {
    const afterIndex = findClosestTextIndex(markdown, afterNeedle, estimatedOffset)
    if (afterIndex >= 0) return clampTextOffset(markdown, afterIndex)
  }

  return clampTextOffset(markdown, estimatedOffset)
}

function getSourceOffsetFromRenderedSelection(view: EditorView, markdown: string) {
  const { selection, doc } = view.state
  if (!(selection instanceof TextSelection)) return null
  return getSourceOffsetFromRenderedTextSelection(selection, doc, markdown)
}

function getSourceOffsetFromRenderedPosition(view: EditorView, markdown: string, position: number) {
  try {
    const safePosition = Math.max(0, Math.min(view.state.doc.content.size, position))
    const selection = TextSelection.near(view.state.doc.resolve(safePosition), 1)
    if (!(selection instanceof TextSelection)) {
      throw new Error('No text selection near rendered position')
    }
    return getSourceOffsetFromRenderedTextSelection(selection, view.state.doc, markdown)
  } catch {
    return markdown.length > 0
      ? Math.round((position / Math.max(1, view.state.doc.content.size)) * markdown.length)
      : 0
  }
}

function normalizeSourceNeedle(text: string) {
  return text
    .replace(/!\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanSourceLine(line: string) {
  const trimmed = line.trim()
  if (!trimmed || /^`{3,}/.test(trimmed) || /^\|?[\s:|-]+\|?$/.test(trimmed)) {
    return ''
  }

  return normalizeSourceNeedle(
    trimmed
      .replace(/^\s{0,3}#{1,6}\s*/, '')
      .replace(/^(\s{0,3}>\s*)+/, '')
      .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s*)/, '')
  )
}

function getLineAtOffset(text: string, offset: number) {
  const safeOffset = clampTextOffset(text, offset)
  const start = text.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1
  const nextBreak = text.indexOf('\n', safeOffset)
  const end = nextBreak >= 0 ? nextBreak : text.length
  return {
    start,
    end,
    column: safeOffset - start,
    line: text.slice(start, end),
  }
}

function getTableCellAtColumn(line: string, column: number) {
  if (!line.includes('|') || /^\s*\|?[\s:-]+\|?\s*$/.test(line)) return ''

  let cellStart = 0
  for (let index = 0; index <= line.length; index += 1) {
    if (line[index] !== '|' && index !== line.length) continue

    if (column >= cellStart && column <= index) {
      return cleanSourceLine(line.slice(cellStart, index))
    }
    cellStart = index + 1
  }

  return ''
}

function getNearbyNonEmptyLine(text: string, start: number, direction: -1 | 1) {
  let cursor = start
  for (let index = 0; index < 8; index += 1) {
    if (direction < 0) {
      const previousBreak = text.lastIndexOf('\n', Math.max(0, cursor - 2))
      if (previousBreak < 0) return ''
      const lineStart = text.lastIndexOf('\n', Math.max(0, previousBreak - 1)) + 1
      const line = cleanSourceLine(text.slice(lineStart, previousBreak))
      if (line) return line
      cursor = lineStart
    } else {
      const nextStart = text.indexOf('\n', cursor)
      if (nextStart < 0) return ''
      const lineStart = nextStart + 1
      const nextBreak = text.indexOf('\n', lineStart)
      const lineEnd = nextBreak >= 0 ? nextBreak : text.length
      const line = cleanSourceLine(text.slice(lineStart, lineEnd))
      if (line) return line
      cursor = lineEnd
    }
  }

  return ''
}

function getWordAtOffset(text: string, offset: number) {
  const safeOffset = clampTextOffset(text, offset)
  const before = text.slice(0, safeOffset).match(/[A-Za-z0-9가-힣_.:/-]+$/)?.[0] ?? ''
  const after = text.slice(safeOffset).match(/^[A-Za-z0-9가-힣_.:/-]+/)?.[0] ?? ''
  return normalizeSourceNeedle(`${before}${after}`)
}

function getSourceCursorNeedles(text: string, offset: number) {
  const { line, column, start, end } = getLineAtOffset(text, offset)
  const needles: string[] = []
  const addNeedle = (value: string) => {
    const needle = normalizeSourceNeedle(value).slice(0, 180)
    if (needle.length < 2 || needles.includes(needle)) return
    needles.push(needle)
  }

  addNeedle(getTableCellAtColumn(line, column))
  addNeedle(getWordAtOffset(text, offset))
  addNeedle(cleanSourceLine(line))
  addNeedle(getNearbyNonEmptyLine(text, start, -1))
  addNeedle(getNearbyNonEmptyLine(text, end, 1))

  return needles
}

function findRenderedPositionFromSourceCursor(doc: ProseNode, markdown: string, offset: number) {
  const needles = getSourceCursorNeedles(markdown, offset)
  const estimatedPos = markdown.length > 0
    ? Math.round((offset / markdown.length) * doc.content.size)
    : 0

  if (needles.length === 0) return Math.max(0, Math.min(doc.content.size, estimatedPos))

  let renderedText = ''
  const positions: number[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    for (let index = 0; index < node.text.length; index += 1) {
      renderedText += node.text[index]
      positions.push(pos + index)
    }
  })

  const lowerRenderedText = renderedText.toLocaleLowerCase()
  let bestPosition: number | null = null
  let bestScore = Number.POSITIVE_INFINITY

  needles.forEach((needle, needleIndex) => {
    const lowerNeedle = needle.toLocaleLowerCase()
    let index = lowerRenderedText.indexOf(lowerNeedle)
    while (index >= 0) {
      const position = positions[index]
      const score = Math.abs(position - estimatedPos) - lowerNeedle.length * 3 + needleIndex * 24
      if (score < bestScore) {
        bestScore = score
        bestPosition = position
      }
      index = lowerRenderedText.indexOf(lowerNeedle, index + Math.max(1, lowerNeedle.length))
    }
  })

  return bestPosition ?? Math.max(0, Math.min(doc.content.size, estimatedPos))
}

function findClosestTextIndex(text: string, needle: string, targetOffset: number) {
  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  let index = text.indexOf(needle)
  while (index >= 0) {
    const distance = Math.abs(index - targetOffset)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
    index = text.indexOf(needle, index + Math.max(1, needle.length))
  }
  return bestIndex
}

function clampTextOffset(text: string, offset: number) {
  return Math.max(0, Math.min(offset, text.length))
}

function focusSourceEditorAtOffset(
  textarea: HTMLTextAreaElement,
  offset: number,
  scrollInternally = true
) {
  const safeOffset = clampTextOffset(textarea.value, offset)
  textarea.focus()
  textarea.setSelectionRange(safeOffset, safeOffset)

  if (!scrollInternally) {
    textarea.scrollTop = 0
    return
  }

  const style = window.getComputedStyle(textarea)
  const lineHeight = Number.parseFloat(style.lineHeight) || 22
  const lineCount = textarea.value.slice(0, safeOffset).split(/\r\n|\r|\n/).length
  textarea.scrollTop = Math.max(0, (lineCount - 1) * lineHeight - textarea.clientHeight / 2)
}

function getSourceOffsetFromTextareaViewport(textarea: HTMLTextAreaElement) {
  const style = window.getComputedStyle(textarea)
  const lineHeight = Number.parseFloat(style.lineHeight) || 22
  const targetLine = Math.max(0, Math.floor((textarea.scrollTop + textarea.clientHeight * 0.34) / lineHeight))
  const lines = textarea.value.split(/\r\n|\r|\n/)
  let offset = 0

  for (let index = 0; index < Math.min(targetLine, lines.length); index += 1) {
    offset += lines[index].length + 1
  }

  return clampTextOffset(textarea.value, offset)
}

function scrollSourceEditorToOffset(
  textarea: HTMLTextAreaElement,
  offset: number,
  behavior: ScrollBehavior = 'auto'
) {
  const safeOffset = clampTextOffset(textarea.value, offset)
  const style = window.getComputedStyle(textarea)
  const lineHeight = Number.parseFloat(style.lineHeight) || 22
  const lineCount = textarea.value.slice(0, safeOffset).split(/\r\n|\r|\n/).length

  textarea.scrollTo({
    top: Math.max(0, (lineCount - 1) * lineHeight - textarea.clientHeight * 0.34),
    behavior,
  })
}

function sameDocumentMetadata(left: DocumentMetadata | null, right: DocumentMetadata | null) {
  return Boolean(
    left &&
      right &&
      left.path === right.path &&
      left.modifiedMs === right.modifiedMs &&
      left.len === right.len
  )
}

type IconName =
  | 'file-plus'
  | 'folder-open'
  | 'reload'
  | 'save'
  | 'source'
  | 'panel-left'
  | 'panel-right'
  | 'toc'
  | 'panel-top-close'
  | 'panel-top-open'
  | 'palette'
  | 'chevron-down'
  | 'check'
  | 'table'
  | 'table-row-add'
  | 'table-column-add'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'trash'
  | 'undo'
  | 'redo'
  | 'text'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'bullet-list'
  | 'ordered-list'
  | 'quote'
  | 'code-block'
  | 'horizontal-rule'
  | 'link'
  | 'image'
  | 'mermaid'
  | 'math'

const APP_ICON_MAP: Record<IconName, string> = {
  'file-plus': 'note_add',
  'folder-open': 'folder_open',
  reload: 'refresh',
  save: 'save',
  source: 'code',
  'panel-left': 'left_panel_open',
  'panel-right': 'right_panel_open',
  toc: 'toc',
  'panel-top-close': 'keyboard_arrow_up',
  'panel-top-open': 'keyboard_arrow_down',
  palette: 'palette',
  'chevron-down': 'keyboard_arrow_down',
  check: 'check',
  table: 'table',
  'table-row-add': 'add_row_below',
  'table-column-add': 'add_column_right',
  'align-left': 'format_align_left',
  'align-center': 'format_align_center',
  'align-right': 'format_align_right',
  trash: 'delete',
  undo: 'undo',
  redo: 'redo',
  text: 'text_fields',
  'heading-1': 'format_h1',
  'heading-2': 'format_h2',
  'heading-3': 'format_h3',
  bold: 'format_bold',
  italic: 'format_italic',
  strike: 'format_strikethrough',
  'bullet-list': 'format_list_bulleted',
  'ordered-list': 'format_list_numbered',
  quote: 'format_quote',
  'code-block': 'data_object',
  'horizontal-rule': 'horizontal_rule',
  link: 'link',
  image: 'image',
  mermaid: 'account_tree',
  math: 'function',
}

function AppIcon({ name, className = '' }: { name: IconName; className?: string }) {
  const icon = APP_ICON_MAP[name]

  return (
    <span
      className={`material-symbols-outlined app-icon ${className}`.trim()}
      aria-hidden="true"
    >
      {icon}
    </span>
  )
}

function ToolbarButton({
  title,
  children,
  onAction,
  disabled = false,
  className = '',
}: {
  title: string
  children: React.ReactNode
  onAction: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={`toolbar-button ${className}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(event) => {
        event.preventDefault()
        if (!disabled) onAction()
      }}
    >
      {children}
    </button>
  )
}

function CmuxPaneEditor({
  document,
  onChange,
}: {
  document: PaneDocument
  onChange: (path: string, text: string) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const textRef = useRef(document.text)
  const applyingDocumentTextRef = useRef(false)
  const sourceOnly = !isMarkdownDocumentPath(document.path)
  const [sourceText, setSourceText] = useState(document.text)

  useEffect(() => {
    if (sourceOnly || !hostRef.current) return

    let disposed = false
    let instance: Editor | null = null
    textRef.current = document.text
    initializeMermaid()

    void MilkdownEditor.make()
      .config((ctx) => {
        ctx.set(rootCtx, hostRef.current!)
        ctx.set(defaultValueCtx, document.text)
        ctx.set(katexOptionsCtx.key, {
          throwOnError: false,
          strict: false,
          output: 'htmlAndMathml',
        })
        ctx.set(codeBlockAttr.key, (node) => {
          const language = String(node.attrs.language ?? '').trim().toLowerCase()
          if (language === 'mermaid') {
            return {
              pre: {},
              code: { spellcheck: 'false' },
            }
          }

          return {
            pre: { class: 'md-code-block plain-code-block code-source' },
            code: { spellcheck: 'false' },
          }
        })

        ctx
          .get(listenerCtx)
          .markdownUpdated((_ctx, nextMarkdown) => {
            textRef.current = nextMarkdown
            if (!applyingDocumentTextRef.current) {
              onChange(document.path, nextMarkdown)
            }
          })
      })
      .use(codeBlockEnterGuard)
      .use(tableCellEnterGuard)
      .use(externalLinkOpenHandler)
      .use(commonmark)
      .use(gfm)
      .use(frontmatter)
      .use(math)
      .use(history)
      .use(listener)
      .use(codeSyntaxHighlighting)
      .use(clipboard)
      .use(indent)
      .use(trailing)
      .use(documentDirectoryCtx)
      .use(codeBlockView)
      .use(imageView)
      .create()
      .then((editor) => {
        if (disposed) {
          void editor.destroy()
          return
        }
        instance = editor
        editorRef.current = editor
        editor.action((ctx) => {
          ctx.set(documentDirectoryCtx.key, dirname(document.path))
        })
      })
      .catch((error) => {
        void writeDebugLog(`cmux pane editor init failed: ${document.path}, error=${describeError(error)}`)
      })

    return () => {
      disposed = true
      if (instance) void instance.destroy()
      editorRef.current = null
    }
  }, [document.path, onChange, sourceOnly])

  useEffect(() => {
    if (sourceOnly) return
    if (document.text === textRef.current) return

    const editor = editorRef.current
    if (!editor) return

    textRef.current = document.text
    applyingDocumentTextRef.current = true
    try {
      editor.action(replaceAll(document.text, true))
    } finally {
      window.setTimeout(() => {
        applyingDocumentTextRef.current = false
      }, 0)
    }
  }, [document.text, sourceOnly])

  useEffect(() => {
    if (!sourceOnly) return
    textRef.current = document.text
    setSourceText(document.text)
  }, [document.path, document.text, sourceOnly])

  if (sourceOnly) {
    return (
      <textarea
        className="cmux-side-text-editor"
        value={sourceText}
        spellCheck={false}
        wrap="off"
        aria-label={`${document.name} 원문 편집`}
        onChange={(event) => {
          const value = event.currentTarget.value
          textRef.current = value
          setSourceText(value)
          onChange(document.path, value)
        }}
      />
    )
  }

  return (
    <div
      ref={hostRef}
      className="cmux-side-milkdown-host"
      aria-label={`${document.name} 편집기`}
    />
  )
}

export default function App() {
  const appShellRef = useRef<HTMLElement | null>(null)
  const workspaceRef = useRef<HTMLElement | null>(null)
  const editorPaperRef = useRef<HTMLElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null)
  const sourceHighlightRef = useRef<HTMLPreElement | null>(null)
  const themePickerRef = useRef<HTMLDivElement | null>(null)
  const documentSearchInputRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const tauriFilePathRef = useRef<string | null>(null)
  const browserFileHandleRef = useRef<BrowserFileHandle | null>(null)
  const markdownRef = useRef(DEFAULT_MD)
  const sourceDraftRef = useRef(DEFAULT_MD)
  const lastSavedTextRef = useRef(DEFAULT_MD)
  const dirtyRef = useRef(false)
  const statusRef = useRef('에디터 준비 중…')
  const sourceModeRef = useRef(false)
  const sourceOnlyModeRef = useRef(false)
  const autoSaveEnabledRef = useRef(true)
  const autoSaveTimerRef = useRef<number | null>(null)
  const markdownStateTimerRef = useRef<number | null>(null)
  const sourcePreviewTimerRef = useRef<number | null>(null)
  const sourceCursorSyncFrameRef = useRef<number | null>(null)
  const sourceScrollSyncFrameRef = useRef<number | null>(null)
  const renderedScrollSyncFrameRef = useRef<number | null>(null)
  const scrollSyncUnlockTimerRef = useRef<number | null>(null)
  const scrollSyncOriginRef = useRef<'source' | 'rendered' | null>(null)
  const typewriterModeRef = useRef(false)
  const typewriterScrollFrameRef = useRef<number | null>(null)
  const activeBlockRef = useRef<HTMLElement | null>(null)
  const editorFocusedRef = useRef(false)
  const outlineRef = useRef<OutlineItem[]>([])
  const pendingOutlineRef = useRef<OutlineItem[] | null>(null)
  const documentSearchIndexRef = useRef(0)
  const searchRequestRef = useRef(0)
  const documentOpenRequestRef = useRef(0)
  const sourceHighlightRequestRef = useRef(0)
  const sourceHighlightTimerRef = useRef<number | null>(null)
  const dropHandledRef = useRef(false)
  const markdownChangedRef = useRef<(markdown: string) => void>(() => undefined)
  const loadDocumentRef = useRef<(text: string, options: LoadDocumentOptions) => void>(() => undefined)
  const pendingDocumentRef = useRef<PendingDocument | null>(null)
  const documentMetadataRef = useRef<DocumentMetadata | null>(null)
  const externalFileChangedRef = useRef(false)
  const mainTabIdCounterRef = useRef(1)
  const activeMainTabIdRef = useRef<string | null>(INITIAL_MAIN_TAB.id)
  const mainTabsRef = useRef<MainDocumentTab[]>([INITIAL_MAIN_TAB])
  const mainTabsStateSyncTimerRef = useRef<number | null>(null)
  const rightPaneTabsRef = useRef<PaneDocument[]>([])
  const rightPaneTabsStateSyncTimerRef = useRef<number | null>(null)
  const outlineUpdateTimerRef = useRef<number | null>(null)
  const pendingOutlineDocRef = useRef<ProseNode | null>(null)

  const [markdown, setMarkdown] = useState(DEFAULT_MD)
  const [sourceDraft, setSourceDraft] = useState(DEFAULT_MD)
  const [sourceMode, setSourceMode] = useState(false)
  const [sourceOnlyMode, setSourceOnlyMode] = useState(false)
  const [sourceEditorFocused, setSourceEditorFocused] = useState(false)
  const [editorReady, setEditorReady] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [fileName, setFileName] = useState('제목 없음.md')
  const [status, setStatus] = useState('에디터 준비 중…')
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [activeOutlinePos, setActiveOutlinePos] = useState<number | null>(null)
  const [typewriterMode, setTypewriterMode] = useState(false)
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true)
  const [navigationOpen, setNavigationOpen] = useState(readNavigationOpen)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>(readSidebarTab)
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null)
  const [externalFileChanged, setExternalFileChanged] = useState(false)
  const [mainTabs, setMainTabs] = useState<MainDocumentTab[]>(() => [INITIAL_MAIN_TAB])
  const [activeMainTabId, setActiveMainTabId] = useState<string | null>(INITIAL_MAIN_TAB.id)
  const [recentDocuments, setRecentDocuments] = useState<RecentDocument[]>(readRecentDocuments)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([])
  const [searching, setSearching] = useState(false)
  const [documentSearchOpen, setDocumentSearchOpen] = useState(false)
  const [documentSearchQuery, setDocumentSearchQuery] = useState('')
  const [documentSearchIndex, setDocumentSearchIndex] = useState(0)
  const [documentSearchCount, setDocumentSearchCount] = useState(0)
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode)
  const [themePickerOpen, setThemePickerOpen] = useState(false)
  const [formatbarVisible, setFormatbarVisible] = useState(readFormatbarVisible)
  const [viewDensity, setViewDensity] = useState<ViewDensity>(readViewDensity)
  const [navigationWidth, setNavigationWidth] = useState(readNavigationWidth)
  const [outlineWidth, setOutlineWidth] = useState(readOutlineWidth)
  const [sourceSplitPercent, setSourceSplitPercent] = useState(readSourceSplitPercent)
  const [cmuxPaneSplitPercent, setCmuxPaneSplitPercent] = useState(readCmuxPaneSplitPercent)
  const [rightPaneTabs, setRightPaneTabs] = useState<PaneDocument[]>([])
  const [activeRightPanePath, setActiveRightPanePath] = useState<string | null>(null)
  const [tableToolbar, setTableToolbar] = useState<TableToolbarState | null>(null)
  const [activeCodeLanguage, setActiveCodeLanguage] = useState<string | null>(null)
  const [sourceHighlightState, setSourceHighlightState] = useState<SourceHighlightState | null>(null)

  const currentText = sourceMode ? sourceDraft : markdown
  const stats = useMemo(() => countDocument(currentText), [currentText])
  const sourceLanguage = useMemo(
    () => getSourceLanguage(currentFilePath ?? fileName),
    [currentFilePath, fileName]
  )
  const sourceHighlightAllowed =
    sourceMode &&
    !sourceEditorFocused &&
    sourceLanguage.length > 0 &&
    sourceDraft.length <= MAX_SOURCE_HIGHLIGHT_LENGTH
  const sourceHighlightActive =
    sourceHighlightAllowed &&
    sourceHighlightState?.text === sourceDraft &&
    sourceHighlightState.language === sourceLanguage
  const sourceHighlightRanges = sourceHighlightActive ? sourceHighlightState.ranges : []
  const sourceHighlightContent = useMemo(
    () => (sourceHighlightActive ? renderHighlightedSource(sourceDraft, sourceHighlightRanges) : null),
    [sourceDraft, sourceHighlightActive, sourceHighlightRanges]
  )
  const currentThemeOption = useMemo(
    () => THEME_OPTIONS.find((option) => option.value === themeMode) ?? THEME_OPTIONS[0],
    [themeMode]
  )
  const createMainTabId = useCallback(() => {
    const id = `main-tab-${Date.now()}-${mainTabIdCounterRef.current}`
    mainTabIdCounterRef.current += 1
    return id
  }, [])

  const replaceMainTabs = useCallback((tabs: MainDocumentTab[]) => {
    mainTabsRef.current = tabs
    setMainTabs(tabs)
  }, [])

  const updateMainTabs = useCallback((updater: (tabs: MainDocumentTab[]) => MainDocumentTab[]) => {
    const nextTabs = updater(mainTabsRef.current)
    mainTabsRef.current = nextTabs
    setMainTabs(nextTabs)
  }, [])

  const scheduleMainTabsStateSync = useCallback(() => {
    if (mainTabsStateSyncTimerRef.current !== null) {
      window.clearTimeout(mainTabsStateSyncTimerRef.current)
    }
    mainTabsStateSyncTimerRef.current = window.setTimeout(() => {
      mainTabsStateSyncTimerRef.current = null
      setMainTabs(mainTabsRef.current)
    }, 700)
  }, [])

  const replaceRightPaneTabs = useCallback((tabs: PaneDocument[]) => {
    rightPaneTabsRef.current = tabs
    setRightPaneTabs(tabs)
  }, [])

  const updateRightPaneTabs = useCallback((updater: (tabs: PaneDocument[]) => PaneDocument[]) => {
    const nextTabs = updater(rightPaneTabsRef.current)
    rightPaneTabsRef.current = nextTabs
    setRightPaneTabs(nextTabs)
  }, [])

  const scheduleRightPaneTabsStateSync = useCallback(() => {
    if (rightPaneTabsStateSyncTimerRef.current !== null) {
      window.clearTimeout(rightPaneTabsStateSyncTimerRef.current)
    }
    rightPaneTabsStateSyncTimerRef.current = window.setTimeout(() => {
      rightPaneTabsStateSyncTimerRef.current = null
      setRightPaneTabs(rightPaneTabsRef.current)
    }, 700)
  }, [])

  useEffect(() => {
    activeMainTabIdRef.current = activeMainTabId
  }, [activeMainTabId])

  const rightPaneActiveDocument = useMemo(() => {
    if (rightPaneTabs.length === 0) return null
    return (
      rightPaneTabs.find((document) => document.path === activeRightPanePath) ??
      rightPaneTabs[rightPaneTabs.length - 1]
    )
  }, [activeRightPanePath, rightPaneTabs])
  const rightPaneStats = useMemo(
    () => rightPaneActiveDocument ? countDocument(rightPaneActiveDocument.text) : null,
    [rightPaneActiveDocument]
  )
  const cmuxPaneOpen = rightPaneTabs.length > 0

  const markScrollSyncOrigin = useCallback((origin: 'source' | 'rendered') => {
    scrollSyncOriginRef.current = origin
    if (scrollSyncUnlockTimerRef.current !== null) {
      window.clearTimeout(scrollSyncUnlockTimerRef.current)
    }
    scrollSyncUnlockTimerRef.current = window.setTimeout(() => {
      scrollSyncUnlockTimerRef.current = null
      scrollSyncOriginRef.current = null
    }, 120)
  }, [])

  const getRenderedScrollContainer = useCallback(() => {
    const host = hostRef.current
    if (!host) return null
    if (sourceModeRef.current && !sourceOnlyModeRef.current) return host

    return host.closest<HTMLElement>('.editor-scroll') ?? host
  }, [])

  const scrollRenderedPaneToSourceOffset = useCallback((
    offset: number,
    forceScroll = false,
    behavior: ScrollBehavior = 'smooth',
    updateRenderedSelection = false
  ) => {
    const editor = editorRef.current
    if (!editor || !sourceModeRef.current || sourceOnlyModeRef.current) return
    const markdownText = sourceDraftRef.current

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const position = findRenderedPositionFromSourceCursor(view.state.doc, markdownText, offset)
      const safePosition = Math.max(0, Math.min(view.state.doc.content.size, position))
      const selection = TextSelection.near(view.state.doc.resolve(safePosition), 1)

      if (updateRenderedSelection) {
        view.dispatch(view.state.tr.setSelection(selection))
      }

      window.requestAnimationFrame(() => {
        if (!view.dom.isConnected) return
        const renderedPane = getRenderedScrollContainer()
        if (!renderedPane) return

        try {
          const coords = view.coordsAtPos(selection.from)
          const parentRect = renderedPane.getBoundingClientRect()
          const margin = 92
          const shouldScroll =
            forceScroll ||
            coords.top < parentRect.top + margin ||
            coords.bottom > parentRect.bottom - margin

          if (shouldScroll) {
            markScrollSyncOrigin('source')
            renderedPane.scrollTo({
              top: Math.max(
                0,
                renderedPane.scrollTop + coords.top - parentRect.top - renderedPane.clientHeight * 0.34
              ),
              behavior,
            })
          }
        } catch {
          // 렌더 위치 계산 실패 시 원문 포커스만 유지합니다.
        }

      })
    })
  }, [getRenderedScrollContainer, markScrollSyncOrigin])

  const syncRenderedCursorFromSource = useCallback((
    forceScroll = false,
    behavior: ScrollBehavior = 'smooth'
  ) => {
    const textarea = sourceEditorRef.current
    if (!textarea || !sourceModeRef.current || sourceOnlyModeRef.current) return

    const selectionStart = textarea.selectionStart
    const selectionEnd = textarea.selectionEnd
    scrollRenderedPaneToSourceOffset(selectionStart, forceScroll, behavior, true)

    window.requestAnimationFrame(() => {
      if (!textarea.isConnected) return
      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(selectionStart, selectionEnd)
    })
  }, [scrollRenderedPaneToSourceOffset])

  const syncSourceHighlightScroll = useCallback(() => {
    const textarea = sourceEditorRef.current
    const highlight = sourceHighlightRef.current
    if (!textarea || !highlight) return

    highlight.scrollTop = textarea.scrollTop
    highlight.scrollLeft = textarea.scrollLeft
  }, [])

  const scheduleRenderedCursorSync = useCallback((
    forceScroll = false,
    behavior: ScrollBehavior = 'smooth'
  ) => {
    if (sourceCursorSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(sourceCursorSyncFrameRef.current)
    }

    sourceCursorSyncFrameRef.current = window.requestAnimationFrame(() => {
      sourceCursorSyncFrameRef.current = null
      syncRenderedCursorFromSource(forceScroll, behavior)
    })
  }, [syncRenderedCursorFromSource])

  const handleSourceCursorActivity = useCallback(() => {
    scheduleRenderedCursorSync(false, 'auto')
  }, [scheduleRenderedCursorSync])

  const handleSourceEditorFocus = useCallback(() => {
    setSourceEditorFocused(true)
    handleSourceCursorActivity()
  }, [handleSourceCursorActivity])

  const handleSourceEditorBlur = useCallback(() => {
    setSourceEditorFocused(false)
  }, [])

  const handleSourcePaneScroll = useCallback(() => {
    syncSourceHighlightScroll()
    if (scrollSyncOriginRef.current === 'rendered') return
    if (sourceScrollSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(sourceScrollSyncFrameRef.current)
    }

    sourceScrollSyncFrameRef.current = window.requestAnimationFrame(() => {
      sourceScrollSyncFrameRef.current = null
      const textarea = sourceEditorRef.current
      if (!textarea || !sourceModeRef.current || sourceOnlyModeRef.current) return
      const offset = getSourceOffsetFromTextareaViewport(textarea)
      scrollRenderedPaneToSourceOffset(offset, true, 'auto')
    })
  }, [scrollRenderedPaneToSourceOffset, syncSourceHighlightScroll])

  const handleRenderedPaneScroll = useCallback(() => {
    if (scrollSyncOriginRef.current === 'source') return
    if (renderedScrollSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(renderedScrollSyncFrameRef.current)
    }

    renderedScrollSyncFrameRef.current = window.requestAnimationFrame(() => {
      renderedScrollSyncFrameRef.current = null
      const renderedPane = getRenderedScrollContainer()
      const host = hostRef.current
      const editor = editorRef.current
      if (!renderedPane || !host || !editor) {
        return
      }

      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const paneRect = renderedPane.getBoundingClientRect()
        const hostRect = host.getBoundingClientRect()
        const found = view.posAtCoords({
          left: Math.min(hostRect.right - 12, hostRect.left + Math.min(48, Math.max(12, hostRect.width * 0.12))),
          top: paneRect.top + renderedPane.clientHeight * 0.34,
        })
        if (!found) return

        const activeOutline = outlineRef.current
          .filter((item) => item.pos <= found.pos)
          .at(-1)
        if (activeOutline) setActiveOutlinePos(activeOutline.pos)

        const textarea = sourceEditorRef.current
        if (!textarea || !sourceModeRef.current || sourceOnlyModeRef.current) {
          return
        }

        const offset = getSourceOffsetFromRenderedPosition(view, sourceDraftRef.current, found.pos)
        markScrollSyncOrigin('rendered')
        scrollSourceEditorToOffset(textarea, offset, 'auto')
      })
    })
  }, [getRenderedScrollContainer, markScrollSyncOrigin])

  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    if (!themePickerOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && themePickerRef.current?.contains(target)) return
      setThemePickerOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setThemePickerOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [themePickerOpen])

  useEffect(() => {
    sourceModeRef.current = sourceMode
    if (sourceMode) setTableToolbar(null)
    if (!sourceMode) setSourceEditorFocused(false)
  }, [sourceMode])

  useEffect(() => {
    sourceOnlyModeRef.current = sourceOnlyMode
  }, [sourceOnlyMode])

  useEffect(() => {
    const requestId = sourceHighlightRequestRef.current + 1
    sourceHighlightRequestRef.current = requestId

    if (sourceHighlightTimerRef.current !== null) {
      window.clearTimeout(sourceHighlightTimerRef.current)
      sourceHighlightTimerRef.current = null
    }

    if (!sourceHighlightAllowed) {
      setSourceHighlightState((current) => (current === null ? current : null))
      return
    }

    const text = sourceDraft
    const language = sourceLanguage
    setSourceHighlightState((current) => (
      current?.text === text && current.language === language ? current : null
    ))

    sourceHighlightTimerRef.current = window.setTimeout(() => {
      sourceHighlightTimerRef.current = null
      const ranges = highlightCodeRanges(text, language)
      if (sourceHighlightRequestRef.current !== requestId) return
      setSourceHighlightState({ text, language, ranges })
    }, SOURCE_HIGHLIGHT_DELAY_MS)

    return () => {
      if (sourceHighlightTimerRef.current !== null) {
        window.clearTimeout(sourceHighlightTimerRef.current)
        sourceHighlightTimerRef.current = null
      }
    }
  }, [sourceDraft, sourceHighlightAllowed, sourceLanguage])

  useEffect(() => {
    const textarea = sourceEditorRef.current
    if (!textarea) return

    textarea.style.height = ''
    window.requestAnimationFrame(syncSourceHighlightScroll)
  }, [
    sourceMode,
    sourceOnlyMode,
    syncSourceHighlightScroll,
  ])

  useEffect(() => {
    if (!sourceMode) return
    window.requestAnimationFrame(syncSourceHighlightScroll)
  }, [sourceDraft, sourceHighlightActive, sourceMode, sourceOnlyMode, syncSourceHighlightScroll])

  useEffect(() => {
    if (sourceOnlyMode || (!outlineOpen && !sourceMode)) return

    const renderedPane = getRenderedScrollContainer()
    if (!renderedPane) return

    renderedPane.addEventListener('scroll', handleRenderedPaneScroll, { passive: true })
    return () => renderedPane.removeEventListener('scroll', handleRenderedPaneScroll)
  }, [getRenderedScrollContainer, handleRenderedPaneScroll, outlineOpen, sourceMode, sourceOnlyMode])

  useEffect(() => {
    typewriterModeRef.current = typewriterMode
  }, [typewriterMode])

  useEffect(() => {
    autoSaveEnabledRef.current = autoSaveEnabled
  }, [autoSaveEnabled])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    try {
      window.localStorage.setItem(THEME_MODE_KEY, themeMode)
    } catch {
      // 테마 저장 실패 시에도 현재 세션의 화면 모드는 유지합니다.
    }
  }, [themeMode])

  useEffect(() => {
    try {
      window.localStorage.setItem(FORMATBAR_VISIBLE_KEY, formatbarVisible ? '1' : '0')
    } catch {
      // 서식바 표시 설정 저장에 실패해도 현재 세션의 표시 상태는 유지합니다.
    }
  }, [formatbarVisible])

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_DENSITY_KEY, viewDensity)
    } catch {
      // 보기 간격 저장 실패는 현재 세션의 표시 상태에 영향을 주지 않습니다.
    }
  }, [viewDensity])

  useEffect(() => {
    try {
      window.localStorage.setItem(NAVIGATION_OPEN_KEY, navigationOpen ? '1' : '0')
    } catch {
      // 탐색 패널 표시 설정 저장 실패는 현재 화면 상태에 영향을 주지 않습니다.
    }
  }, [navigationOpen])

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_TAB_KEY, sidebarTab)
    } catch {
      // 탐색 탭 저장 실패는 현재 세션 사용을 막지 않습니다.
    }
  }, [sidebarTab])

  useEffect(() => {
    try {
      window.localStorage.setItem(NAVIGATION_WIDTH_KEY, String(Math.round(navigationWidth)))
    } catch {
      // 사이드바 폭 저장 실패는 앱 사용을 막지 않습니다.
    }
  }, [navigationWidth])

  useEffect(() => {
    try {
      window.localStorage.setItem(OUTLINE_WIDTH_KEY, String(Math.round(outlineWidth)))
    } catch {
      // 목차 폭 저장 실패는 앱 사용을 막지 않습니다.
    }
  }, [outlineWidth])

  useEffect(() => {
    try {
      window.localStorage.setItem(SOURCE_SPLIT_KEY, String(Math.round(sourceSplitPercent)))
    } catch {
      // 분할 폭 저장 실패는 앱 사용을 막지 않습니다.
    }
  }, [sourceSplitPercent])

  useEffect(() => {
    try {
      window.localStorage.setItem(CMUX_PANE_SPLIT_KEY, String(Math.round(cmuxPaneSplitPercent)))
    } catch {
      // 패널 분할 폭 저장 실패는 앱 사용을 막지 않습니다.
    }
  }, [cmuxPaneSplitPercent])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        RECENT_DOCUMENTS_KEY,
        JSON.stringify(recentDocuments)
      )
    } catch {
      // WebView 저장소가 비활성화된 환경에서는 최근 문서만 비영구적으로 유지합니다.
    }
  }, [recentDocuments])

  const setDocumentDirectory = useCallback((path: string | null) => {
    const editor = editorRef.current
    if (!editor) return
    const directory = path ? dirname(path) : ''
    editor.action((ctx) => {
      ctx.set(documentDirectoryCtx.key, directory)
    })
    editor.action(forceUpdate())
  }, [])

  const hasVisualEditorFocus = useCallback(() => {
    if (
      document.activeElement &&
      hostRef.current?.contains(document.activeElement)
    ) {
      return true
    }

    const editor = editorRef.current
    if (!editor) return editorFocusedRef.current

    try {
      return Boolean(editor.action((ctx) => ctx.get(editorViewCtx).hasFocus()))
    } catch {
      return editorFocusedRef.current
    }
  }, [])

  const readDocumentMetadata = useCallback(async (path: string | null = tauriFilePathRef.current) => {
    if (!path || !isTauriRuntime()) return null
    return invokeTauri<DocumentMetadata>('document_metadata', { path })
  }, [])

  const readDocumentMetadataQuietly = useCallback(
    async (path: string | null = tauriFilePathRef.current) => {
      try {
        return await readDocumentMetadata(path)
      } catch (error) {
        void writeDebugLog(`document metadata failed: ${describeError(error)}`)
        return null
      }
    },
    [readDocumentMetadata]
  )

  const setKnownDocumentMetadata = useCallback((metadata: DocumentMetadata | null) => {
    documentMetadataRef.current = metadata
    externalFileChangedRef.current = false
    setExternalFileChanged(false)
  }, [])

  const updateMainTab = useCallback((tabId: string, updates: Partial<MainDocumentTab>) => {
    updateMainTabs((tabs) =>
      tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, ...updates }
          : tab
      )
    )
  }, [updateMainTabs])

  const updateActiveMainTab = useCallback((updates: Partial<MainDocumentTab>) => {
    const tabId = activeMainTabIdRef.current
    if (!tabId) return
    updateMainTab(tabId, updates)
  }, [updateMainTab])

  const updateActiveMainTabText = useCallback((text: string, nextDirty: boolean) => {
    const tabId = activeMainTabIdRef.current
    if (!tabId) return
    let shouldRender = false
    let changed = false
    const nextTabs = mainTabsRef.current.map((tab) => {
      if (tab.id !== tabId) return tab
      shouldRender = tab.dirty !== nextDirty
      if (tab.text === text && tab.dirty === nextDirty) return tab
      changed = true
      return { ...tab, text, dirty: nextDirty }
    })
    if (!changed) return
    mainTabsRef.current = nextTabs
    if (shouldRender) {
      setMainTabs(nextTabs)
      return
    }
    scheduleMainTabsStateSync()
  }, [scheduleMainTabsStateSync])

  const writeExistingFile = useCallback(async (text: string) => {
    const tauriPath = tauriFilePathRef.current
    if (tauriPath) {
      await invokeTauri<void>('write_markdown_file', {
        path: tauriPath,
        contents: text,
      })
      const metadata = await readDocumentMetadataQuietly(tauriPath)
      if (metadata) {
        tauriFilePathRef.current = metadata.path
        setCurrentFilePath(metadata.path)
        setDocumentDirectory(metadata.path)
      }
      setKnownDocumentMetadata(metadata)
      return true
    }

    const browserHandle = browserFileHandleRef.current
    if (browserHandle) {
      const writable = await browserHandle.createWritable()
      await writable.write(text)
      await writable.close()
      return true
    }

    return false
  }, [readDocumentMetadataQuietly, setDocumentDirectory, setKnownDocumentMetadata])

  const scheduleAutoSave = useCallback(
    (text: string) => {
      if (!autoSaveEnabledRef.current) return
      if (externalFileChangedRef.current) return
      if (!tauriFilePathRef.current && !browserFileHandleRef.current) return
      const scheduledTabId = activeMainTabIdRef.current
      const scheduledTauriPath = tauriFilePathRef.current
      const scheduledBrowserHandle = browserFileHandleRef.current
      if (!scheduledTabId) return
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current)
      }

      autoSaveTimerRef.current = window.setTimeout(async () => {
        autoSaveTimerRef.current = null
        if (activeMainTabIdRef.current !== scheduledTabId) return
        if (
          tauriFilePathRef.current !== scheduledTauriPath ||
          browserFileHandleRef.current !== scheduledBrowserHandle
        ) {
          return
        }
        try {
          const saved = await writeExistingFile(text)
          if (!saved) return
          lastSavedTextRef.current = text
          const current = sourceModeRef.current
            ? sourceDraftRef.current
            : markdownRef.current
          if (current === text) {
            dirtyRef.current = false
            const savedPath = tauriFilePathRef.current
            updateMainTab(scheduledTabId, {
              path: savedPath,
              name: savedPath ? basename(savedPath) : fileName,
              text,
              savedText: text,
              dirty: false,
              browserHandle: browserFileHandleRef.current,
              metadata: documentMetadataRef.current,
            })
            statusRef.current = '자동 저장됨'
            if (!hasVisualEditorFocus()) {
              setDirty(false)
              setStatus('자동 저장됨')
            }
          }
        } catch (error) {
          setStatus(`자동 저장 실패: ${String(error)}`)
        }
      }, 900)
    },
    [fileName, hasVisualEditorFocus, updateMainTab, writeExistingFile]
  )

  const flushMarkdownState = useCallback(() => {
    if (markdownStateTimerRef.current !== null) {
      window.clearTimeout(markdownStateTimerRef.current)
      markdownStateTimerRef.current = null
    }

    setMarkdown(markdownRef.current)
  }, [])

  const scheduleMarkdownStateUpdate = useCallback(() => {
    if (markdownStateTimerRef.current !== null) {
      window.clearTimeout(markdownStateTimerRef.current)
      markdownStateTimerRef.current = null
    }
    if (hasVisualEditorFocus()) return

    markdownStateTimerRef.current = window.setTimeout(() => {
      markdownStateTimerRef.current = null
      setMarkdown(markdownRef.current)
    }, 80)
  }, [hasVisualEditorFocus])

  const updateOutline = useCallback((nextOutline: OutlineItem[], options: { force?: boolean; resetActive?: boolean } = {}) => {
    outlineRef.current = nextOutline
    if (!options.force && hasVisualEditorFocus()) {
      pendingOutlineRef.current = nextOutline
      return
    }

    pendingOutlineRef.current = null
    setOutline((currentOutline) =>
      areOutlinesEqual(currentOutline, nextOutline) ? currentOutline : nextOutline
    )
    if (options.resetActive) {
      setActiveOutlinePos(nextOutline[0]?.pos ?? null)
    } else {
      setActiveOutlinePos((currentPos) =>
        nextOutline.some((item) => item.pos === currentPos) ? currentPos : nextOutline[0]?.pos ?? null
      )
    }
  }, [hasVisualEditorFocus])

  const flushScheduledOutlineUpdate = useCallback(() => {
    if (outlineUpdateTimerRef.current !== null) {
      window.clearTimeout(outlineUpdateTimerRef.current)
      outlineUpdateTimerRef.current = null
    }
    const doc = pendingOutlineDocRef.current
    pendingOutlineDocRef.current = null
    if (doc) updateOutline(collectOutline(doc))
  }, [updateOutline])

  const scheduleOutlineUpdate = useCallback((doc: ProseNode) => {
    pendingOutlineDocRef.current = doc
    if (outlineUpdateTimerRef.current !== null) {
      window.clearTimeout(outlineUpdateTimerRef.current)
    }
    outlineUpdateTimerRef.current = window.setTimeout(() => {
      outlineUpdateTimerRef.current = null
      const pendingDoc = pendingOutlineDocRef.current
      pendingOutlineDocRef.current = null
      if (pendingDoc) updateOutline(collectOutline(pendingDoc))
    }, 240)
  }, [updateOutline])

  const updateTableToolbar = useCallback((view: EditorView, selection: Selection) => {
    if (sourceModeRef.current) {
      setTableToolbar(null)
      return
    }

    const table = findTable(selection.$from)
    if (!table) {
      setTableToolbar(null)
      return
    }

    const tableDom = view.nodeDOM(table.pos)
    const element =
      tableDom instanceof HTMLElement
        ? tableDom
        : tableDom?.parentElement ?? null

    if (!element) {
      setTableToolbar(null)
      return
    }

    const paper = editorPaperRef.current
    const rect = element.getBoundingClientRect()
    const paperRect = paper?.getBoundingClientRect()
    if (!paperRect || rect.width <= 0 || rect.height <= 0) {
      setTableToolbar(null)
      return
    }

    const nextToolbar = {
      left: clampNumber(rect.left - paperRect.left, 0, Math.max(0, paperRect.width - 170)),
      top: Math.max(0, rect.top - paperRect.top),
    }

    setTableToolbar((current) => {
      if (
        current &&
        Math.abs(current.left - nextToolbar.left) < 1 &&
        Math.abs(current.top - nextToolbar.top) < 1
      ) {
        return current
      }
      return nextToolbar
    })
  }, [])

  markdownChangedRef.current = (nextMarkdown: string) => {
    markdownRef.current = nextMarkdown
    if (sourceModeRef.current) return

    scheduleMarkdownStateUpdate()
    const nextDirty = nextMarkdown !== lastSavedTextRef.current
    updateActiveMainTabText(nextMarkdown, nextDirty)
    if (dirtyRef.current !== nextDirty) {
      dirtyRef.current = nextDirty
      if (!hasVisualEditorFocus()) setDirty(nextDirty)
    }
    if (nextDirty) {
      if (statusRef.current !== '편집 중') {
        statusRef.current = '편집 중'
        if (!hasVisualEditorFocus()) setStatus('편집 중')
      }
      scheduleAutoSave(nextMarkdown)
    }
  }

  useEffect(() => {
    if (!hostRef.current) return
    let disposed = false
    let instance: Editor | null = null

    initializeMermaid()

    void MilkdownEditor.make()
      .config((ctx) => {
        ctx.set(rootCtx, hostRef.current!)
        ctx.set(defaultValueCtx, DEFAULT_MD)
        ctx.set(katexOptionsCtx.key, {
          throwOnError: false,
          strict: false,
          output: 'htmlAndMathml',
        })
        ctx.set(codeBlockAttr.key, (node) => {
          const language = String(node.attrs.language ?? '').trim().toLowerCase()
          if (language === 'mermaid') {
            return {
              pre: {},
              code: { spellcheck: 'false' },
            }
          }

          return {
            pre: { class: 'md-code-block plain-code-block code-source' },
            code: { spellcheck: 'false' },
          }
        })

        ctx
          .get(listenerCtx)
          .markdownUpdated((_ctx, nextMarkdown) => {
            markdownChangedRef.current(nextMarkdown)
          })
          .updated((_ctx, doc) => {
            scheduleOutlineUpdate(doc)
          })
          .focus(() => {
            editorFocusedRef.current = true
          })
          .blur(() => {
            editorFocusedRef.current = false
            setTableToolbar(null)
            setDirty(dirtyRef.current)
            setStatus(statusRef.current)
            flushScheduledOutlineUpdate()
            if (pendingOutlineRef.current) {
              updateOutline(pendingOutlineRef.current)
            }
            flushMarkdownState()
          })
          .selectionUpdated((listenerContext, selection) => {
            const view = listenerContext.get(editorViewCtx)
            updateTableToolbar(view, selection)
            setActiveCodeLanguage(getCodeBlockSelectionInfo(selection)?.language ?? null)
            const currentOutline = outlineRef.current
            const activeOutline = currentOutline
              .filter((item) => item.pos <= selection.from)
              .at(-1)
            setActiveOutlinePos(activeOutline?.pos ?? currentOutline[0]?.pos ?? null)

            if (!typewriterModeRef.current) return

            if (!view.dom) return

            const { $from } = selection
            const topLevelPos = $from.depth >= 1 ? $from.before(1) : selection.from
            const nodeDom = view.nodeDOM(topLevelPos)
            const element =
              nodeDom instanceof HTMLElement
                ? nodeDom
                : nodeDom?.parentElement ?? null

            if (element) {
              const blockChanged = activeBlockRef.current !== element
              activeBlockRef.current = element
              if (blockChanged && typewriterModeRef.current) {
                if (typewriterScrollFrameRef.current !== null) {
                  cancelAnimationFrame(typewriterScrollFrameRef.current)
                }
                typewriterScrollFrameRef.current = requestAnimationFrame(() => {
                  typewriterScrollFrameRef.current = null
                  if (element.isConnected) {
                    element.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center',
                    })
                  }
                })
              }
            } else {
              activeBlockRef.current = null
            }
          })
          .mounted((listenerContext) => {
            const view = listenerContext.get(editorViewCtx)
            updateOutline(collectOutline(view.state.doc))
            setEditorReady(true)
            setStatus('준비됨')
          })
      })
      .use(codeBlockEnterGuard)
      .use(tableCellEnterGuard)
      .use(externalLinkOpenHandler)
      .use(commonmark)
      .use(gfm)
      .use(frontmatter)
      .use(math)
      .use(history)
      .use(listener)
      .use(documentSearchDecorations)
      .use(codeSyntaxHighlighting)
      .use(clipboard)
      .use(indent)
      .use(trailing)
      .use(documentDirectoryCtx)
      .use(codeBlockView)
      .use(imageView)
      .create()
      .then((editor) => {
        if (disposed) {
          void editor.destroy()
          return
        }
        instance = editor
        editorRef.current = editor
        const pendingDocument = pendingDocumentRef.current
        if (pendingDocument) {
          pendingDocumentRef.current = null
          loadDocumentRef.current(pendingDocument.text, pendingDocument.options)
        }
      })
      .catch((error) => {
        void writeDebugLog(`editor init failed: ${describeError(error)}`)
        setStatus(`에디터 초기화 실패: ${String(error)}`)
      })

    return () => {
      disposed = true
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current)
      }
      if (markdownStateTimerRef.current !== null) {
        window.clearTimeout(markdownStateTimerRef.current)
      }
      if (mainTabsStateSyncTimerRef.current !== null) {
        window.clearTimeout(mainTabsStateSyncTimerRef.current)
      }
      if (rightPaneTabsStateSyncTimerRef.current !== null) {
        window.clearTimeout(rightPaneTabsStateSyncTimerRef.current)
      }
      if (outlineUpdateTimerRef.current !== null) {
        window.clearTimeout(outlineUpdateTimerRef.current)
      }
      if (sourcePreviewTimerRef.current !== null) {
        window.clearTimeout(sourcePreviewTimerRef.current)
      }
      if (sourceCursorSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(sourceCursorSyncFrameRef.current)
      }
      if (sourceScrollSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(sourceScrollSyncFrameRef.current)
      }
      if (renderedScrollSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(renderedScrollSyncFrameRef.current)
      }
      if (scrollSyncUnlockTimerRef.current !== null) {
        window.clearTimeout(scrollSyncUnlockTimerRef.current)
      }
      if (typewriterScrollFrameRef.current !== null) {
        cancelAnimationFrame(typewriterScrollFrameRef.current)
      }
      editorFocusedRef.current = false
      if (instance) void instance.destroy()
      editorRef.current = null
    }
  }, [
    flushMarkdownState,
    flushScheduledOutlineUpdate,
    scheduleOutlineUpdate,
    updateOutline,
    updateTableToolbar,
  ])

  useEffect(() => {
    const marker = dirty ? ' •' : ''
    document.title = `${fileName}${marker} — Markview`
  }, [dirty, fileName])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const hasDirtyMainTab = mainTabsRef.current.some((tab) => tab.dirty)
      const hasDirtySideTab = rightPaneTabsRef.current.some((tab) => tab.dirty)
      if (!dirtyRef.current && !hasDirtyMainTab && !hasDirtySideTab) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const confirmDiscard = useCallback(() => {
    if (!dirtyRef.current) return true
    return window.confirm('저장하지 않은 변경사항이 있습니다. 계속할까요?')
  }, [])

  const recordRecentDocument = useCallback((path: string) => {
    setRecentDocuments((documents) => [
      { path, name: basename(path), openedAt: Date.now() },
      ...documents.filter((document) => document.path !== path),
    ].slice(0, MAX_RECENT_DOCUMENTS))
  }, [])

  const loadDocument = useCallback(
    (text: string, options: LoadDocumentOptions) => {
      const editor = editorRef.current
      if (!editor) {
        pendingDocumentRef.current = { text, options }
        void writeDebugLog(`loadDocument queued: ${options.name}, chars=${text.length}`)
        setStatus(`${options.name} 열기 대기 중`)
        return
      }

      void writeDebugLog(`loadDocument start: ${options.name}, chars=${text.length}, path=${options.tauriPath ?? 'browser'}`)

      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
      if (sourcePreviewTimerRef.current !== null) {
        window.clearTimeout(sourcePreviewTimerRef.current)
        sourcePreviewTimerRef.current = null
      }

      const resolvedTauriPath = options.metadata?.path ?? options.tauriPath ?? null
      tauriFilePathRef.current = resolvedTauriPath
      browserFileHandleRef.current = options.browserHandle ?? null
      setKnownDocumentMetadata(options.metadata ?? null)
      const sourceOnly = !isMarkdownDocumentPath(resolvedTauriPath ?? options.name)
      const savedText = options.savedText ?? text
      const nextDirty = options.dirty ?? text !== savedText
      markdownRef.current = text
      sourceDraftRef.current = text
      lastSavedTextRef.current = savedText
      dirtyRef.current = nextDirty
      setMarkdown(text)
      setSourceDraft(text)
      setDirty(nextDirty)
      setFileName(options.name)
      setCurrentFilePath(resolvedTauriPath)
      setDocumentDirectory(resolvedTauriPath)
      const targetTabId = options.tabId ?? activeMainTabId ?? createMainTabId()
      activeMainTabIdRef.current = targetTabId
      setActiveMainTabId(targetTabId)
      updateMainTabs((tabs) => {
        const nextTab: MainDocumentTab = {
          id: targetTabId,
          path: resolvedTauriPath,
          name: options.name,
          text,
          savedText,
          dirty: nextDirty,
          browserHandle: options.browserHandle ?? null,
          metadata: options.metadata ?? null,
        }
        const tabIndex = tabs.findIndex((tab) => tab.id === targetTabId)
        if (tabIndex < 0) return [...tabs, nextTab]

        const nextTabs = [...tabs]
        nextTabs[tabIndex] = nextTab
        return nextTabs
      })
      if (resolvedTauriPath) recordRecentDocument(resolvedTauriPath)

      let visualLoaded = false
      let visualError: unknown = null
      let loadedOutline: OutlineItem[] = []
      if (!sourceOnly) {
        try {
          visualLoaded = editor.action((ctx) => {
            const doc = ctx.get(parserCtx)(text)
            if (!doc) return false
            loadedOutline = collectOutline(doc)
            replaceAll(text, true)(ctx)
            return true
          })
        } catch (error) {
          visualError = error
          visualLoaded = false
        }
      }
      updateOutline(visualLoaded ? loadedOutline : [], { force: true, resetActive: true })
      if (sourceOnly) {
        setOutlineOpen(false)
      }

      if (!visualLoaded && !sourceOnly) {
        void writeDebugLog(
          `loadDocument visual fallback: ${options.name}${visualError ? `, error=${describeError(visualError)}` : ''}`
        )
      } else {
        void writeDebugLog(`loadDocument visual ok: ${options.name}`)
      }

      const nextSourceMode = sourceOnly || !visualLoaded
      sourceModeRef.current = nextSourceMode
      sourceOnlyModeRef.current = sourceOnly
      setSourceMode(nextSourceMode)
      setSourceOnlyMode(sourceOnly)
      setStatus(nextSourceMode ? `${options.name} 원문으로 열림` : `${options.name} 열림`)
    },
    [
      activeMainTabId,
      createMainTabId,
      recordRecentDocument,
      setDocumentDirectory,
      setKnownDocumentMetadata,
      updateOutline,
      updateMainTabs,
    ]
  )

  loadDocumentRef.current = loadDocument

  const openTauriDocument = useCallback(
    async (path: string, options: { tabId?: string | null } = {}) => {
      void writeDebugLog(`openTauriDocument start: ${path}`)
      if (!isSupportedDocumentPath(path)) {
        void writeDebugLog(`openTauriDocument unsupported path: ${path}`)
        throw new Error('지원하지 않는 텍스트 파일 형식입니다.')
      }

      const text = await invokeTauri<string>('read_markdown_file', { path })
      const metadata = await readDocumentMetadataQuietly(path)
      void writeDebugLog(`openTauriDocument read ok: ${path}, chars=${text.length}`)
      loadDocument(text, {
        name: basename(path),
        tauriPath: path,
        metadata,
        tabId: options.tabId,
      })
    },
    [loadDocument, readDocumentMetadataQuietly]
  )

  const loadMainTabDocument = useCallback(
    async (tab: MainDocumentTab) => {
      loadDocument(tab.text, {
        name: tab.name,
        tauriPath: tab.path,
        browserHandle: tab.browserHandle ?? null,
        metadata: tab.metadata ?? null,
        tabId: tab.id,
        savedText: tab.savedText,
        dirty: tab.dirty,
      })
    },
    [loadDocument]
  )

  const switchMainTab = useCallback(
    async (tabId: string) => {
      if (tabId === activeMainTabId) return true
      const tab = mainTabsRef.current.find((candidate) => candidate.id === tabId)
      if (!tab) return false

      try {
        await loadMainTabDocument(tab)
        return true
      } catch (error) {
        setStatus(`탭 전환 실패: ${String(error)}`)
        return false
      }
    },
    [activeMainTabId, loadMainTabDocument]
  )

  const loadWorkspace = useCallback(
    async (root: string, options: { silent?: boolean } = {}) => {
      setWorkspaceLoading(true)
      try {
        const snapshot = await invokeTauri<WorkspaceSnapshot>('scan_workspace', { root })
        setWorkspace(snapshot)
        setExpandedFolders((current) => {
          const available = collectDirectoryPaths(snapshot.entries)
          const next = new Set(
            [...current].filter((path) => available.has(path))
          )
          if (next.size === 0) {
            snapshot.entries
              .filter((entry) => entry.isDirectory)
              .forEach((entry) => next.add(entry.path))
          }
          return next
        })
        try {
          window.localStorage.setItem(WORKSPACE_ROOT_KEY, snapshot.root)
        } catch {
          // 작업 폴더 복원만 비활성화하고 현재 세션은 계속 사용합니다.
        }
        if (!options.silent) {
          setStatus(`${snapshot.name} 폴더 · ${snapshot.fileCount.toLocaleString()}개 파일`)
        }
        return snapshot
      } finally {
        setWorkspaceLoading(false)
      }
    },
    []
  )

  const revealDocumentWorkspace = useCallback(
    async (path: string) => {
      try {
        const snapshot = await loadWorkspace(dirname(path), { silent: true })
        setSidebarTab('files')
        setNavigationOpen(true)
        void writeDebugLog(`document workspace loaded: ${snapshot.root}`)
      } catch (error) {
        void writeDebugLog(
          `document workspace load failed: ${path}, error=${describeError(error)}`
        )
      }
    },
    [loadWorkspace]
  )

  const openWorkspace = useCallback(async () => {
    try {
      const tauri = await getTauriModules()
      if (!tauri) {
        setStatus('폴더 탐색은 macOS 앱에서 사용할 수 있습니다.')
        return
      }

      const selected = await tauri.open({
        directory: true,
        multiple: false,
        title: '작업 폴더 열기',
      })
      const root = Array.isArray(selected) ? selected[0] : selected
      if (!root) return

      await loadWorkspace(root)
      setSidebarTab('files')
      setNavigationOpen(true)
    } catch (error) {
      const message = String(error)
      if (!message.toLowerCase().includes('cancel')) {
        setStatus(`폴더 열기 실패: ${message}`)
      }
    }
  }, [loadWorkspace])

  const refreshWorkspace = useCallback(async () => {
    if (!workspace) return
    try {
      const snapshot = await loadWorkspace(workspace.root, { silent: true })
      setStatus(`폴더 새로고침됨 · ${snapshot.fileCount.toLocaleString()}개 파일`)
    } catch (error) {
      setStatus(`폴더 새로고침 실패: ${String(error)}`)
    }
  }, [loadWorkspace, workspace])

  const closeWorkspace = useCallback(() => {
    setWorkspace(null)
    setExpandedFolders(new Set())
    setSearchQuery('')
    setSearchResults([])
    try {
      window.localStorage.removeItem(WORKSPACE_ROOT_KEY)
    } catch {
      // 저장소 접근 실패는 현재 화면 상태에 영향을 주지 않습니다.
    }
    setStatus('작업 폴더 닫힘')
  }, [])

  const toggleWorkspaceFolder = useCallback((path: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const openDocumentPath = useCallback(
    async (path: string, options: { newTab?: boolean; tabId?: string | null } = {}) => {
      const existingTab = !options.newTab
        ? mainTabsRef.current.find((tab) => tab.path === path)
        : null
      if (existingTab) {
        recordRecentDocument(path)
        return switchMainTab(existingTab.id)
      }

      if (!options.newTab && path === tauriFilePathRef.current) {
        recordRecentDocument(path)
        return true
      }

      const requestId = ++documentOpenRequestRef.current
      const activeTab = activeMainTabId
        ? mainTabsRef.current.find((tab) => tab.id === activeMainTabId)
        : null
      const shouldReuseActiveTab =
        !options.newTab &&
        !options.tabId &&
        Boolean(activeTab) &&
        !activeTab?.dirty
      const targetTabId =
        options.tabId ??
        (shouldReuseActiveTab ? activeMainTabId ?? createMainTabId() : createMainTabId())
      try {
        void writeDebugLog(`openDocumentPath start: ${path}`)
        if (!isSupportedDocumentPath(path)) {
          void writeDebugLog(`openDocumentPath unsupported path: ${path}`)
          throw new Error('지원하지 않는 텍스트 파일 형식입니다.')
        }

        const text = await invokeTauri<string>('read_markdown_file', { path })
        const metadata = await readDocumentMetadataQuietly(path)
        if (requestId !== documentOpenRequestRef.current) {
          void writeDebugLog(`openDocumentPath ignored stale: ${path}`)
          return false
        }

        void writeDebugLog(`openDocumentPath read ok: ${path}, chars=${text.length}`)
        loadDocument(text, {
          name: basename(metadata?.path ?? path),
          tauriPath: path,
          metadata,
          tabId: targetTabId,
        })
        return true
      } catch (error) {
        if (requestId !== documentOpenRequestRef.current) return false
        setStatus(`파일 열기 실패: ${String(error)}`)
        return false
      }
    },
    [
      activeMainTabId,
      createMainTabId,
      loadDocument,
      readDocumentMetadataQuietly,
      recordRecentDocument,
      switchMainTab,
    ]
  )

  const reloadCurrentDocument = useCallback(async () => {
    const path = tauriFilePathRef.current
    if (!path) {
      setStatus('다시 불러올 로컬 파일이 없습니다.')
      return
    }
    if (!confirmDiscard()) return

    try {
      const text = await invokeTauri<string>('read_markdown_file', { path })
      const metadata = await readDocumentMetadataQuietly(path)
      loadDocument(text, { name: basename(path), tauriPath: path, metadata })
      setStatus(`${basename(path)} 다시 불러옴`)
    } catch (error) {
      setStatus(`다시 불러오기 실패: ${String(error)}`)
    }
  }, [confirmDiscard, loadDocument, readDocumentMetadataQuietly])

  const openDocumentPathInNewTab = useCallback(
    async (path: string) => {
      return openDocumentPath(path, { newTab: true })
    },
    [openDocumentPath]
  )

  const closeMainTab = useCallback(
    (tabId: string) => {
      const tabs = mainTabsRef.current
      const tabIndex = tabs.findIndex((tab) => tab.id === tabId)
      if (tabIndex < 0) return

      const closingActiveTab = tabId === activeMainTabId
      const hasUnsavedChanges = closingActiveTab ? dirtyRef.current : tabs[tabIndex].dirty
      if (
        hasUnsavedChanges &&
        !window.confirm(`${tabs[tabIndex].name}에 저장하지 않은 변경사항이 있습니다. 탭을 닫을까요?`)
      ) {
        return
      }

      const nextTabs = tabs.filter((tab) => tab.id !== tabId)
      if (nextTabs.length === 0) {
        const nextTab: MainDocumentTab = {
          ...INITIAL_MAIN_TAB,
          id: createMainTabId(),
        }
        replaceMainTabs([nextTab])
        void loadMainTabDocument(nextTab)
        return
      }

      replaceMainTabs(nextTabs)
      if (!closingActiveTab) return

      const nextTab = nextTabs[Math.min(tabIndex, nextTabs.length - 1)]
      void loadMainTabDocument(nextTab).catch((error) => {
        setStatus(`탭 닫기 실패: ${String(error)}`)
      })
    },
    [
      activeMainTabId,
      createMainTabId,
      loadMainTabDocument,
      replaceMainTabs,
    ]
  )

  useEffect(() => {
    if (!editorReady || !currentFilePath || !isTauriRuntime()) return

    let disposed = false

    const checkCurrentFile = async () => {
      const path = tauriFilePathRef.current
      if (!path || externalFileChangedRef.current) return

      try {
        const metadata = await readDocumentMetadata(path)
        if (disposed || !metadata || metadata.path !== tauriFilePathRef.current) return

        const known = documentMetadataRef.current
        if (!known) {
          documentMetadataRef.current = metadata
          return
        }
        if (sameDocumentMetadata(known, metadata)) return

        externalFileChangedRef.current = true
        setExternalFileChanged(true)
        setStatus(
          dirtyRef.current
            ? '문서가 외부에서 변경됨. 저장되지 않은 편집 내용을 확인하세요.'
            : '문서가 외부에서 변경됨. 다시 불러오기를 눌러주세요.'
        )
      } catch {
        // 파일이 이동/삭제된 경우에도 편집 중인 내용을 방해하지 않습니다.
      }
    }

    void checkCurrentFile()
    const timer = window.setInterval(checkCurrentFile, FILE_CHANGE_CHECK_INTERVAL_MS)

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [currentFilePath, editorReady, readDocumentMetadata])

  useEffect(() => {
    if (!editorReady || !isTauriRuntime()) return
    let savedRoot: string | null = null
    try {
      savedRoot = window.localStorage.getItem(WORKSPACE_ROOT_KEY)
    } catch {
      return
    }
    if (!savedRoot) return

    void loadWorkspace(savedRoot, { silent: true }).catch((error) => {
      try {
        window.localStorage.removeItem(WORKSPACE_ROOT_KEY)
      } catch {
        // 복원 실패 메시지만 표시합니다.
      }
      setStatus(`이전 작업 폴더 복원 실패: ${String(error)}`)
    })
  }, [editorReady, loadWorkspace])

  useEffect(() => {
    if (!workspace || !currentFilePath || !isPathInsideRoot(currentFilePath, workspace.root)) {
      return
    }

    const ancestors = ancestorDirectories(currentFilePath, workspace.root)
    if (ancestors.length === 0) return

    setExpandedFolders((current) => {
      const next = new Set(current)
      let changed = false
      for (const path of ancestors) {
        if (!next.has(path)) {
          next.add(path)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [currentFilePath, workspace])

  useEffect(() => {
    const query = searchQuery.trim()
    const requestId = ++searchRequestRef.current

    if (!workspace || query.length < 2 || !isTauriRuntime()) {
      setSearchResults([])
      setSearching(false)
      return
    }

    setSearching(true)
    const timer = window.setTimeout(() => {
      void invokeTauri<SearchMatch[]>('search_workspace', {
        root: workspace.root,
        query,
        limit: 250,
      })
        .then((results) => {
          if (searchRequestRef.current !== requestId) return
          setSearchResults(results)
          setSearching(false)
        })
        .catch((error) => {
          if (searchRequestRef.current !== requestId) return
          setSearchResults([])
          setSearching(false)
          setStatus(`전체 검색 실패: ${String(error)}`)
        })
    }, 220)

    return () => window.clearTimeout(timer)
  }, [searchQuery, workspace])

  const newDocument = useCallback(() => {
    const tabId = createMainTabId()
    loadDocument(NEW_DOCUMENT, {
      name: '제목 없음.md',
      tauriPath: null,
      browserHandle: null,
      tabId,
    })
  }, [createMainTabId, loadDocument])

  const openWithInputElement = useCallback(async () => {
    return new Promise<{ text: string; name: string } | null>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = `${OPENABLE_EXTENSION_ACCEPT},text/markdown,text/plain,application/json,text/html,text/css,text/javascript`
      input.addEventListener(
        'change',
        async () => {
          const file = input.files?.[0]
          if (!file) {
            resolve(null)
            return
          }
          resolve({ text: await file.text(), name: file.name })
        },
        { once: true }
      )
      input.click()
    })
  }, [])

  const openFile = useCallback(async () => {
    try {
      const tauri = await getTauriModules()
      if (tauri) {
        const selected = await tauri.open({
          multiple: false,
          filters: [
            { name: 'Markdown', extensions: MARKDOWN_EXTENSIONS },
            { name: 'Text and code', extensions: TEXT_EXTENSIONS },
          ],
        })
        const path = Array.isArray(selected) ? selected[0] : selected
        if (!path) return
        void writeDebugLog(`openFile dialog selected: ${path}`)
        await openDocumentPath(path)
        return
      }

      const picker = (window as typeof window & {
        showOpenFilePicker?: (options: unknown) => Promise<BrowserFileHandle[]>
      }).showOpenFilePicker

      if (picker) {
        const [handle] = await picker.call(window, {
          multiple: false,
          types: [
            {
              description: 'Markdown',
              accept: {
                'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'],
              },
            },
            {
              description: 'Text and code',
              accept: {
                'text/plain': TEXT_EXTENSIONS.map((extension) => `.${extension}`),
                'application/json': ['.json'],
                'text/html': ['.html'],
                'text/css': ['.css'],
                'text/javascript': ['.js', '.ts'],
              },
            },
          ],
        })
        if (!handle) return
        const file = await handle.getFile()
        const activeTab = activeMainTabId
          ? mainTabsRef.current.find((tab) => tab.id === activeMainTabId)
          : null
        const tabId = activeTab && !activeTab.dirty
          ? activeMainTabId
          : createMainTabId()
        loadDocument(await file.text(), {
          name: file.name,
          browserHandle: handle,
          tabId,
        })
        return
      }

      const selected = await openWithInputElement()
      if (selected) {
        const activeTab = activeMainTabId
          ? mainTabsRef.current.find((tab) => tab.id === activeMainTabId)
          : null
        const tabId = activeTab && !activeTab.dirty
          ? activeMainTabId
          : createMainTabId()
        loadDocument(selected.text, { name: selected.name, tabId })
      }
    } catch (error) {
      const message = String(error)
      if (!message.toLowerCase().includes('cancel')) {
        setStatus(`열기 실패: ${message}`)
      }
    }
  }, [
    activeMainTabId,
    createMainTabId,
    loadDocument,
    openDocumentPath,
    openWithInputElement,
  ])

  const openDroppedBrowserFile = useCallback(
    async (file: File) => {
      if (!isSupportedDocumentPath(file.name)) {
        setStatus('지원하는 텍스트 파일만 열 수 있습니다.')
        return
      }

      try {
        const path = droppedFilePath(file)
        if (path && isSupportedDocumentPath(path) && isTauriRuntime()) {
          await revealDocumentWorkspace(path)
          await openDocumentPath(path)
          return
        }

        const text = await file.text()
        const activeTab = activeMainTabId
          ? mainTabsRef.current.find((tab) => tab.id === activeMainTabId)
          : null
        const tabId = activeTab && !activeTab.dirty
          ? activeMainTabId
          : createMainTabId()
        void writeDebugLog(`browser drop read ok: ${file.name}, chars=${text.length}`)
        loadDocument(text, { name: file.name, tabId })
      } catch (error) {
        setStatus(`드롭한 파일 열기 실패: ${String(error)}`)
      }
    },
    [
      activeMainTabId,
      createMainTabId,
      loadDocument,
      openDocumentPath,
      revealDocumentWorkspace,
    ]
  )

  useEffect(() => {
    const supportedFileFromDrop = (files: FileList | null | undefined) => {
      if (!files) return null
      return Array.from(files).find((file) => isSupportedDocumentPath(file.name)) ?? null
    }

    const hasFileDrop = (dataTransfer: DataTransfer | null) => {
      if (!dataTransfer) return false
      if (Array.from(dataTransfer.types).includes('Files')) return true
      return Array.from(dataTransfer.items).some((item) => item.kind === 'file')
    }

    const onDragOver = (event: DragEvent) => {
      if (!hasFileDrop(event.dataTransfer)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setStatus('지원하는 텍스트 파일 또는 폴더를 놓으면 엽니다')
    }

    const onDrop = (event: DragEvent) => {
      const file = supportedFileFromDrop(event.dataTransfer?.files)
      if (!file) return

      event.preventDefault()
      if (isTauriRuntime()) {
        window.setTimeout(() => {
          if (!dropHandledRef.current) void openDroppedBrowserFile(file)
        }, 180)
        return
      }

      void openDroppedBrowserFile(file)
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [openDroppedBrowserFile])

  useEffect(() => {
    if (!editorReady || !isTauriRuntime()) return

    let disposed = false
    let unlistenOpened: (() => void) | null = null
    let unlistenDragDrop: (() => void) | null = null
    const recentlyOpened = new Set<string>()

    const handleTargets = async (targets: OpenTarget[]) => {
      void writeDebugLog(
        `handleTargets received: ${
          targets.map((target) => `${target.kind}:${target.path}`).join(', ') || '(empty)'
        }`
      )
      if (disposed) {
        void writeDebugLog('handleTargets ignored: disposed')
        return
      }

      let openedDocument = false

      for (const target of targets) {
        const key = `${target.kind}:${target.path}`
        if (recentlyOpened.has(key)) {
          void writeDebugLog(`handleTargets ignored duplicate: ${key}`)
          continue
        }

        recentlyOpened.add(key)
        window.setTimeout(() => recentlyOpened.delete(key), 1800)

        if (target.kind === 'directory') {
          try {
            const snapshot = await loadWorkspace(target.path)
            setSidebarTab('files')
            setNavigationOpen(true)
            setStatus(`${snapshot.name} 폴더 · ${snapshot.fileCount.toLocaleString()}개 파일`)
          } catch (error) {
            void writeDebugLog(`handleTargets workspace failed: ${target.path}, error=${describeError(error)}`)
            setStatus(`폴더 열기 실패: ${String(error)}`)
          }
          continue
        }

        if (target.kind !== 'file' || !isSupportedDocumentPath(target.path) || openedDocument) {
          continue
        }

        dropHandledRef.current = true
        window.setTimeout(() => {
          dropHandledRef.current = false
        }, 700)

        try {
          await revealDocumentWorkspace(target.path)
          await openDocumentPath(target.path)
          openedDocument = true
        } catch (error) {
          void writeDebugLog(`handleTargets open failed: ${target.path}, error=${describeError(error)}`)
          setStatus(`파일 열기 실패: ${String(error)}`)
        }
      }
    }

    void (async () => {
      const [{ invoke }, { listen }, { getCurrentWebviewWindow }] =
        await Promise.all([
          import('@tauri-apps/api/core'),
          import('@tauri-apps/api/event'),
          import('@tauri-apps/api/webviewWindow'),
        ])

      if (disposed) return

      unlistenOpened = await listen<OpenTarget[]>('opened-targets', (event) => {
        void writeDebugLog(`opened-targets event: ${event.payload.length} target(s)`)
        void handleTargets(event.payload)
      })

      const startupPath = new URLSearchParams(window.location.search).get('openPath')
      if (startupPath) {
        void writeDebugLog(`startup open path: ${startupPath}`)
        await handleTargets([{ kind: 'file', path: startupPath }])
      }

      const initialTargets = startupPath ? [] : await invoke<OpenTarget[]>('take_opened_targets')
      void writeDebugLog(`initial opened targets: ${initialTargets.length}`)
      await handleTargets(initialTargets)

      if (disposed) return

      unlistenDragDrop = await getCurrentWebviewWindow().onDragDropEvent(
        (event) => {
          if (event.payload.type === 'enter') {
            setStatus('지원하는 텍스트 파일 또는 폴더를 놓으면 엽니다')
          } else if (event.payload.type === 'leave') {
            setStatus('준비됨')
          } else if (event.payload.type === 'drop') {
            const paths = event.payload.paths
            void writeDebugLog(`webview drop event: ${paths.join(', ') || '(empty)'}`)
            void (async () => {
              try {
                const targets = await invoke<OpenTarget[]>('resolve_open_targets', { paths })
                await handleTargets(targets)
              } catch (error) {
                void writeDebugLog(`resolve drop targets failed: ${describeError(error)}`)
                setStatus(`드롭한 항목 열기 실패: ${String(error)}`)
              }
            })()
          }
        }
      )
    })().catch((error) => {
      if (!disposed) setStatus(`파일 연결 초기화 실패: ${String(error)}`)
    })

    return () => {
      disposed = true
      unlistenOpened?.()
      unlistenDragDrop?.()
    }
  }, [editorReady, loadWorkspace, openDocumentPath, revealDocumentWorkspace])

  const getLatestMarkdown = useCallback(() => {
    if (sourceModeRef.current) return sourceDraftRef.current
    const editor = editorRef.current
    if (!editor) return markdownRef.current
    return editor.action(getMarkdown()) || markdownRef.current
  }, [])

  const downloadBrowserFile = useCallback((text: string, name: string) => {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }, [])

  const saveFile = useCallback(
    async (saveAs = false) => {
      try {
        const text = getLatestMarkdown()
        if (
          externalFileChangedRef.current &&
          !window.confirm('문서가 외부에서 변경되었습니다. 현재 내용을 저장해 외부 변경을 덮어쓸까요?')
        ) {
          return
        }
        const tauri = await getTauriModules()

        if (tauri) {
          let path = saveAs ? null : tauriFilePathRef.current
          if (!path) {
            path = await tauri.save({
              defaultPath: fileName || '제목 없음.md',
              filters: [
                { name: 'Markdown', extensions: MARKDOWN_EXTENSIONS },
                { name: 'Text and code', extensions: TEXT_EXTENSIONS },
              ],
            })
          }
          if (!path) return

          await invokeTauri<void>('write_markdown_file', {
            path,
            contents: text,
          })
          const metadata = await readDocumentMetadataQuietly(path)
          const savedPath = metadata?.path ?? path
          tauriFilePathRef.current = savedPath
          browserFileHandleRef.current = null
          setKnownDocumentMetadata(metadata)
          setFileName(basename(savedPath))
          setCurrentFilePath(savedPath)
          setDocumentDirectory(savedPath)
          updateActiveMainTab({
            path: savedPath,
            name: basename(savedPath),
            browserHandle: null,
            metadata,
          })
          recordRecentDocument(savedPath)
          if (workspace && isPathInsideRoot(savedPath, workspace.root)) {
            void loadWorkspace(workspace.root, { silent: true }).catch(() => undefined)
          }
        } else {
          let handle = saveAs ? null : browserFileHandleRef.current
          const picker = (window as typeof window & {
            showSaveFilePicker?: (options: unknown) => Promise<BrowserFileHandle>
          }).showSaveFilePicker

          if (!handle && picker) {
            handle = await picker.call(window, {
              suggestedName: fileName || '제목 없음.md',
              types: [
                {
                  description: 'Markdown',
                  accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'] },
                },
                {
                  description: 'Text and code',
                  accept: {
                    'text/plain': TEXT_EXTENSIONS.map((extension) => `.${extension}`),
                    'application/json': ['.json'],
                    'text/html': ['.html'],
                    'text/css': ['.css'],
                    'text/javascript': ['.js', '.ts'],
                  },
                },
              ],
            })
          }

          if (handle) {
            const writable = await handle.createWritable()
            await writable.write(text)
            await writable.close()
            browserFileHandleRef.current = handle
            tauriFilePathRef.current = null
            setKnownDocumentMetadata(null)
            setCurrentFilePath(null)
            if (handle.name) {
              setFileName(handle.name)
              updateActiveMainTab({
                path: null,
                name: handle.name,
                browserHandle: handle,
                metadata: null,
              })
            }
          } else {
            setKnownDocumentMetadata(null)
            downloadBrowserFile(text, fileName || '제목 없음.md')
          }
        }

        lastSavedTextRef.current = text
        const latestAfterSave = getLatestMarkdown()
        markdownRef.current = latestAfterSave
        setMarkdown(latestAfterSave)

        const hasNewerChanges = latestAfterSave !== text
        dirtyRef.current = hasNewerChanges
        setDirty(hasNewerChanges)
        updateActiveMainTab({
          text: latestAfterSave,
          savedText: text,
          dirty: hasNewerChanges,
        })
        statusRef.current = hasNewerChanges ? '저장 후 추가 변경사항 있음' : '저장됨'
        setStatus(hasNewerChanges ? '저장 후 추가 변경사항 있음' : '저장됨')
        if (hasNewerChanges) scheduleAutoSave(latestAfterSave)
      } catch (error) {
        const message = String(error)
        if (!message.toLowerCase().includes('cancel')) {
          setStatus(`저장 실패: ${message}`)
        }
      }
    },
    [
      downloadBrowserFile,
      fileName,
      getLatestMarkdown,
      loadWorkspace,
      recordRecentDocument,
      readDocumentMetadataQuietly,
      scheduleAutoSave,
      setDocumentDirectory,
      setKnownDocumentMetadata,
      updateActiveMainTab,
      workspace,
    ]
  )

  const applySourceAndReturn = useCallback(() => {
    const text = sourceDraftRef.current
    const editor = editorRef.current
    if (!editor) return
    if (sourcePreviewTimerRef.current !== null) {
      window.clearTimeout(sourcePreviewTimerRef.current)
      sourcePreviewTimerRef.current = null
    }
    if (sourceOnlyModeRef.current) {
      const nextDirty = text !== lastSavedTextRef.current
      dirtyRef.current = nextDirty
      setDirty(nextDirty)
      updateActiveMainTabText(text, nextDirty)
      if (nextDirty) scheduleAutoSave(text)
      return
    }
    markdownRef.current = text
    setMarkdown(text)
    editor.action(replaceAll(text, true))
    sourceModeRef.current = false
    setSourceMode(false)
    const nextDirty = text !== lastSavedTextRef.current
    dirtyRef.current = nextDirty
    setDirty(nextDirty)
    updateActiveMainTabText(text, nextDirty)
    if (nextDirty) scheduleAutoSave(text)
  }, [scheduleAutoSave, updateActiveMainTabText])

  const syncSourcePreview = useCallback(() => {
    if (sourcePreviewTimerRef.current !== null) {
      window.clearTimeout(sourcePreviewTimerRef.current)
    }

    sourcePreviewTimerRef.current = window.setTimeout(() => {
      sourcePreviewTimerRef.current = null
      if (!sourceModeRef.current || sourceOnlyModeRef.current) return

      const editor = editorRef.current
      if (!editor) return

      try {
        editor.action(replaceAll(sourceDraftRef.current, true))
        syncRenderedCursorFromSource(false, 'auto')
      } catch {
        // 원문 편집은 계속 유지하고, 미리보기 동기화만 건너뜁니다.
      }
    }, 160)
  }, [syncRenderedCursorFromSource])

  const toggleSourceMode = useCallback(() => {
    if (!editorRef.current) return
    if (sourceModeRef.current) {
      if (sourceOnlyModeRef.current) {
        setStatus('텍스트 파일은 원문 편집만 지원합니다.')
        return
      }
      applySourceAndReturn()
      return
    }

    const latest = getLatestMarkdown()
    const sourceOffset = editorRef.current.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      return getSourceOffsetFromRenderedSelection(view, latest)
    })
    sourceDraftRef.current = latest
    setSourceDraft(latest)
    sourceOnlyModeRef.current = false
    setSourceOnlyMode(false)
    sourceModeRef.current = true
    setSourceMode(true)
    setStatus('Markdown 원문 편집')
    window.setTimeout(() => {
      const textarea = sourceEditorRef.current
      if (!textarea) return
      focusSourceEditorAtOffset(textarea, sourceOffset ?? 0)
      syncRenderedCursorFromSource(true, 'auto')
    }, 0)
  }, [applySourceAndReturn, getLatestMarkdown, syncRenderedCursorFromSource])

  const exportPdf = useCallback(() => {
    if (sourceModeRef.current) applySourceAndReturn()
    window.setTimeout(() => window.print(), 80)
  }, [applySourceAndReturn])

  const runDocumentSearch = useCallback((
    query: string,
    direction: -1 | 0 | 1 = 0,
    keepSearchFocus = false
  ) => {
    const term = query.trim()

    const updateSearchState = (count: number, index: number) => {
      documentSearchIndexRef.current = index
      setDocumentSearchCount(count)
      setDocumentSearchIndex(index)
    }

    const clearVisualSearchHighlights = () => {
      const editor = editorRef.current
      if (!editor) return
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        view.dispatch(
          view.state.tr.setMeta(documentSearchDecorationsKey, {
            query: '',
            activeIndex: 0,
          })
        )
      })
    }

    if (!term) {
      updateSearchState(0, 0)
      clearVisualSearchHighlights()
      return
    }

    if (sourceModeRef.current) {
      clearVisualSearchHighlights()
      const matches = findTextMatches(sourceDraftRef.current, term)
      if (matches.length === 0) {
        updateSearchState(0, 0)
        setStatus('검색 결과 없음')
        return
      }

      const nextIndex =
        direction === 0
          ? 0
          : (documentSearchIndexRef.current + direction + matches.length) % matches.length
      const match = matches[nextIndex]
      updateSearchState(matches.length, nextIndex)

      window.setTimeout(() => {
        const textarea = sourceEditorRef.current
        if (!textarea) return
        textarea.setSelectionRange(match.from, match.to)
        const line = sourceDraftRef.current.slice(0, match.from).split(/\r?\n/).length - 1
        const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 24
        textarea.scrollTo({
          top: Math.max(0, line * lineHeight - textarea.clientHeight * 0.35),
          behavior: 'smooth',
        })
        if (keepSearchFocus) {
          documentSearchInputRef.current?.focus({ preventScroll: true })
        } else {
          textarea.focus()
        }
      }, 0)
      setStatus(`${nextIndex + 1}/${matches.length} 검색 결과`)
      return
    }

    const editor = editorRef.current
    if (!editor) {
      updateSearchState(0, 0)
      clearVisualSearchHighlights()
      return
    }

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const matches = findDocumentMatches(view.state.doc, term)

      if (matches.length === 0) {
        updateSearchState(0, 0)
        view.dispatch(
          view.state.tr.setMeta(documentSearchDecorationsKey, {
            query: '',
            activeIndex: 0,
          })
        )
        setStatus('검색 결과 없음')
        return
      }

      const nextIndex =
        direction === 0
          ? 0
          : (documentSearchIndexRef.current + direction + matches.length) % matches.length
      const match = matches[nextIndex]
      updateSearchState(matches.length, nextIndex)
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, match.from, match.to))
          .scrollIntoView()
          .setMeta(documentSearchDecorationsKey, {
            query: term,
            activeIndex: nextIndex,
          })
      )
      if (keepSearchFocus) {
        window.requestAnimationFrame(() => {
          try {
            const activeHit = hostRef.current?.querySelector<HTMLElement>(
              '.document-search-hit.is-current'
            )
            if (activeHit) {
              activeHit.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest',
              })
            } else {
              const scrollParent = hostRef.current?.closest('.editor-scroll') as HTMLElement | null
              if (scrollParent) {
                const coords = view.coordsAtPos(match.from)
                const parentRect = scrollParent.getBoundingClientRect()
                scrollParent.scrollTo({
                  top: Math.max(
                    0,
                    scrollParent.scrollTop + coords.top - parentRect.top - scrollParent.clientHeight * 0.28
                  ),
                  behavior: 'smooth',
                })
              }
            }
            documentSearchInputRef.current?.focus({ preventScroll: true })
          } catch {
            documentSearchInputRef.current?.focus({ preventScroll: true })
          }
        })
      } else {
        view.focus()
      }
      setStatus(`${nextIndex + 1}/${matches.length} 검색 결과`)
    })
  }, [])

  const openDocumentSearch = useCallback(() => {
    setDocumentSearchOpen(true)
    if (documentSearchQuery.trim()) {
      runDocumentSearch(documentSearchQuery, 0, true)
    }
    window.setTimeout(() => {
      const input = documentSearchInputRef.current
      input?.focus()
      input?.select()
    }, 0)
  }, [documentSearchQuery, runDocumentSearch])

  const closeDocumentSearch = useCallback(() => {
    setDocumentSearchOpen(false)
    documentSearchIndexRef.current = 0
    setDocumentSearchCount(0)
    setDocumentSearchIndex(0)
    const editor = editorRef.current
    if (!editor) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(
        view.state.tr.setMeta(documentSearchDecorationsKey, {
          query: '',
          activeIndex: 0,
        })
      )
    })
  }, [])

  const showWorkspaceSearch = useCallback(() => {
    setNavigationOpen(true)
    setSidebarTab('search')
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>('.workspace-search-input')?.focus()
    }, 0)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey
      if (!modifier) return
      const key = event.key.toLowerCase()

      if (key === 'f' && event.shiftKey) {
        event.preventDefault()
        showWorkspaceSearch()
      } else if (key === 'f') {
        event.preventDefault()
        openDocumentSearch()
      } else if (key === 'o' && event.shiftKey) {
        event.preventDefault()
        void openWorkspace()
      } else if (key === 's') {
        event.preventDefault()
        void saveFile(event.shiftKey)
      } else if (key === 'o') {
        event.preventDefault()
        void openFile()
      } else if (key === 'n') {
        event.preventDefault()
        newDocument()
      } else if (key === '/') {
        event.preventDefault()
        toggleSourceMode()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    newDocument,
    openDocumentSearch,
    openFile,
    openWorkspace,
    saveFile,
    showWorkspaceSearch,
    toggleSourceMode,
  ])

  const runCommand = useCallback((command: { key: unknown }, payload?: unknown) => {
    const editor = editorRef.current
    if (!editor || sourceModeRef.current) return
    editor.action(callCommand(command.key as never, payload as never))
    editor.action((ctx) => ctx.get(editorViewCtx).focus())
  }, [])

  const insertMarkdown = useCallback((value: string, inline = false) => {
    const editor = editorRef.current
    if (!editor || sourceModeRef.current) return
    editor.action(insert(value, inline))
    editor.action((ctx) => ctx.get(editorViewCtx).focus())
  }, [])

  const addLink = useCallback(() => {
    const href = window.prompt('링크 URL', 'https://')
    if (!href) return
    runCommand(toggleLinkCommand, { href })
  }, [runCommand])

  const addImage = useCallback(() => {
    const src = window.prompt('이미지 경로 또는 URL', './image.png')
    if (!src) return
    const alt = window.prompt('대체 텍스트', '') ?? ''
    runCommand(insertImageCommand, { src, alt, title: alt })
  }, [runCommand])

  const jumpToOutline = useCallback((item: OutlineItem) => {
    const editor = editorRef.current
    if (!editor || sourceOnlyModeRef.current) return
    setActiveOutlinePos(item.pos)

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const safePos = Math.max(0, Math.min(item.pos + 1, view.state.doc.content.size))
      const selection = TextSelection.near(view.state.doc.resolve(safePos), 1)
      view.dispatch(
        view.state.tr
          .setSelection(selection)
          .scrollIntoView()
      )

      window.requestAnimationFrame(() => {
        if (!view.dom.isConnected) return

        const renderedPane = getRenderedScrollContainer()
        if (renderedPane) {
          try {
            const coords = view.coordsAtPos(selection.from)
            const paneRect = renderedPane.getBoundingClientRect()
            markScrollSyncOrigin('source')
            renderedPane.scrollTo({
              top: Math.max(
                0,
                renderedPane.scrollTop + coords.top - paneRect.top - renderedPane.clientHeight * 0.2
              ),
              behavior: 'smooth',
            })
          } catch {
            // 제목 위치 계산 실패 시 ProseMirror의 scrollIntoView 결과만 사용합니다.
          }
        }

        const textarea = sourceEditorRef.current
        if (textarea && sourceModeRef.current && !sourceOnlyModeRef.current) {
          const offset = getSourceOffsetFromRenderedPosition(view, sourceDraftRef.current, safePos)
          markScrollSyncOrigin('rendered')
          scrollSourceEditorToOffset(textarea, offset, 'auto')
        }

        view.focus()
      })
    })
  }, [getRenderedScrollContainer, markScrollSyncOrigin])

  const focusSearchTerm = useCallback((query: string) => {
    const editor = editorRef.current
    const term = query.trim().split(/\s+/).find(Boolean)
    if (!editor || !term || sourceModeRef.current) return false

    return editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const loweredTerm = term.toLocaleLowerCase()
      let matchFrom = -1
      let matchTo = -1

      view.state.doc.descendants((node, pos) => {
        if (matchFrom >= 0 || !node.isText || !node.text) return
        const index = node.text.toLocaleLowerCase().indexOf(loweredTerm)
        if (index < 0) return
        matchFrom = pos + index
        matchTo = matchFrom + term.length
      })

      if (matchFrom < 0 || matchTo < 0) return false
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, matchFrom, matchTo))
          .scrollIntoView()
      )
      view.focus()
      return true
    })
  }, [])

  const openSearchResult = useCallback(
    async (result: SearchMatch) => {
      const opened = await openDocumentPath(result.path)
      if (!opened) return

      if (sourceModeRef.current) applySourceAndReturn()

      setStatus(
        result.line > 0
          ? `${result.name} · ${result.line.toLocaleString()}줄`
          : `${result.name} · 파일 이름 일치`
      )

      if (result.matchKind === 'content') {
        window.setTimeout(() => focusSearchTerm(searchQuery), 90)
      }
    },
    [applySourceAndReturn, focusSearchTerm, openDocumentPath, searchQuery]
  )

  const removeRecentDocument = useCallback((path: string) => {
    setRecentDocuments((documents) =>
      documents.filter((document) => document.path !== path)
    )
  }, [])

  const clearRecentDocuments = useCallback(() => {
    setRecentDocuments([])
  }, [])

  const revealPathInFinder = useCallback(async (path: string) => {
    try {
      await invokeTauri<void>('reveal_path_in_finder', { path })
      setStatus(`${basename(path)} 위치를 Finder에서 열었습니다.`)
    } catch (error) {
      setStatus(`Finder에서 보기 실패: ${String(error)}`)
    }
  }, [])

  const openDocumentInNewWindow = useCallback(async (path?: string | null) => {
    const targetPath = path ?? currentFilePath
    if (!targetPath) {
      setStatus('새 창에서 열 로컬 파일이 없습니다.')
      return
    }

    try {
      await invokeTauri<void>('open_document_window', { path: targetPath })
      const dirtyNote =
        targetPath === currentFilePath && dirtyRef.current
          ? ' · 저장 전 변경사항은 현재 창에만 있습니다'
          : ''
      setStatus(`${basename(targetPath)} 새 창으로 열림${dirtyNote}`)
    } catch (error) {
      setStatus(`새 창 열기 실패: ${String(error)}`)
    }
  }, [currentFilePath])

  const openDocumentInRightPane = useCallback(async (path?: string | null) => {
    const targetPath = path ?? currentFilePath
    if (!targetPath) {
      setStatus('오른쪽 패널에서 열 로컬 파일이 없습니다.')
      return
    }

    try {
      if (!isSupportedDocumentPath(targetPath)) {
        throw new Error('지원하지 않는 텍스트 파일 형식입니다.')
      }

      const existingDocument = rightPaneTabsRef.current.find((document) => document.path === targetPath)
      if (existingDocument) {
        setRightPaneTabs(rightPaneTabsRef.current)
        setActiveRightPanePath(existingDocument.path)
        setStatus(`${existingDocument.name} 오른쪽 패널 활성화됨`)
        return
      }

      const text =
        targetPath === currentFilePath
          ? getLatestMarkdown()
          : await invokeTauri<string>('read_markdown_file', { path: targetPath })
      const savedText =
        targetPath === currentFilePath
          ? lastSavedTextRef.current
          : text
      const metadata =
        targetPath === currentFilePath
          ? documentMetadataRef.current
          : await readDocumentMetadataQuietly(targetPath)
      const paneDocument: PaneDocument = {
        path: metadata?.path ?? targetPath,
        name: basename(metadata?.path ?? targetPath),
        text,
        savedText,
        dirty: text !== savedText,
        openedAt: Date.now(),
        metadata,
      }

      updateRightPaneTabs((tabs) => {
        const existingIndex = tabs.findIndex((document) => document.path === paneDocument.path)
        if (existingIndex >= 0) {
          const next = [...tabs]
          next[existingIndex] = paneDocument
          return next
        }

        return [...tabs, paneDocument]
      })
      setActiveRightPanePath(paneDocument.path)
      recordRecentDocument(paneDocument.path)
      setStatus(`${paneDocument.name} 오른쪽 패널로 열림`)
    } catch (error) {
      setStatus(`오른쪽 패널 열기 실패: ${String(error)}`)
    }
  }, [
    currentFilePath,
    getLatestMarkdown,
    readDocumentMetadataQuietly,
    recordRecentDocument,
    updateRightPaneTabs,
  ])

  const updateRightPaneDocumentText = useCallback((path: string, text: string) => {
    let shouldRender = false
    let changed = false
    const nextTabs = rightPaneTabsRef.current.map((document) => {
      if (document.path !== path) return document
      const nextDirty = text !== document.savedText
      shouldRender = document.dirty !== nextDirty
      if (document.text === text && document.dirty === nextDirty) return document
      changed = true
      return {
        ...document,
        text,
        dirty: nextDirty,
      }
    })
    if (!changed) return
    rightPaneTabsRef.current = nextTabs
    if (shouldRender) {
      setRightPaneTabs(nextTabs)
      return
    }
    scheduleRightPaneTabsStateSync()
  }, [scheduleRightPaneTabsStateSync])

  const activateRightPaneDocument = useCallback((path: string) => {
    setRightPaneTabs(rightPaneTabsRef.current)
    setActiveRightPanePath(path)
  }, [])

  const saveRightPaneDocument = useCallback(async (path?: string | null) => {
    const targetPath = path ?? rightPaneActiveDocument?.path
    if (!targetPath) return
    const targetDocument = rightPaneTabsRef.current.find((document) => document.path === targetPath)
    if (!targetDocument) return

    try {
      await invokeTauri<void>('write_markdown_file', {
        path: targetDocument.path,
        contents: targetDocument.text,
      })
      const metadata = await readDocumentMetadataQuietly(targetDocument.path)
      const resolvedPath = metadata?.path ?? targetDocument.path
      const savedDocument: PaneDocument = {
        ...targetDocument,
        path: resolvedPath,
        name: basename(resolvedPath),
        savedText: targetDocument.text,
        dirty: false,
        metadata,
      }

      updateRightPaneTabs((tabs) =>
        tabs.map((document) =>
          document.path === targetDocument.path ? savedDocument : document
        )
      )
      setActiveRightPanePath(resolvedPath)
      recordRecentDocument(resolvedPath)
      if (workspace && isPathInsideRoot(resolvedPath, workspace.root)) {
        void loadWorkspace(workspace.root, { silent: true }).catch(() => undefined)
      }
      setStatus(`${savedDocument.name} 오른쪽 패널 저장됨`)
    } catch (error) {
      setStatus(`오른쪽 패널 저장 실패: ${String(error)}`)
    }
  }, [
    loadWorkspace,
    readDocumentMetadataQuietly,
    recordRecentDocument,
    rightPaneActiveDocument,
    updateRightPaneTabs,
    workspace,
  ])

  const reloadRightPaneDocument = useCallback(async (path?: string | null) => {
    const targetPath = path ?? rightPaneActiveDocument?.path
    if (!targetPath) return
    const targetDocument = rightPaneTabsRef.current.find((document) => document.path === targetPath)
    if (
      targetDocument?.dirty &&
      !window.confirm(`${targetDocument.name}에 저장하지 않은 변경사항이 있습니다. 다시 불러올까요?`)
    ) {
      return
    }

    try {
      const text = await invokeTauri<string>('read_markdown_file', { path: targetPath })
      const metadata = await readDocumentMetadataQuietly(targetPath)
      const resolvedPath = metadata?.path ?? targetPath
      const nextDocument: PaneDocument = {
        path: resolvedPath,
        name: basename(resolvedPath),
        text,
        savedText: text,
        dirty: false,
        openedAt: Date.now(),
        metadata,
      }

      updateRightPaneTabs((tabs) =>
        tabs.map((document) =>
          document.path === targetPath || document.path === resolvedPath
            ? nextDocument
            : document
        )
      )
      setActiveRightPanePath(resolvedPath)
      setStatus(`${nextDocument.name} 오른쪽 패널 다시 불러옴`)
    } catch (error) {
      setStatus(`오른쪽 패널 다시 불러오기 실패: ${String(error)}`)
    }
  }, [readDocumentMetadataQuietly, rightPaneActiveDocument, updateRightPaneTabs])

  const closeRightPaneTab = useCallback((path: string) => {
    const tabs = rightPaneTabsRef.current
    const index = tabs.findIndex((document) => document.path === path)
    if (index < 0) return
    const document = tabs[index]
    if (
      document.dirty &&
      !window.confirm(`${document.name}에 저장하지 않은 변경사항이 있습니다. 탭을 닫을까요?`)
    ) {
      return
    }
    const nextTabs = tabs.filter((document) => document.path !== path)
    replaceRightPaneTabs(nextTabs)
    setActiveRightPanePath((activePath) => {
      if (activePath !== path) return activePath
      return nextTabs[Math.min(index, nextTabs.length - 1)]?.path ?? null
    })
  }, [replaceRightPaneTabs])

  const closeRightPane = useCallback(() => {
    if (
      rightPaneTabsRef.current.some((document) => document.dirty) &&
      !window.confirm('오른쪽 패널에 저장하지 않은 변경사항이 있습니다. 패널을 닫을까요?')
    ) {
      return
    }
    replaceRightPaneTabs([])
    setActiveRightPanePath(null)
  }, [replaceRightPaneTabs])

  const getWorkspaceTargetDirectory = useCallback(() => {
    if (!workspace) return null
    if (currentFilePath && isPathInsideRoot(currentFilePath, workspace.root)) {
      return dirname(currentFilePath)
    }
    return workspace.root
  }, [currentFilePath, workspace])

  const createWorkspaceFile = useCallback(async () => {
    if (!workspace) {
      setStatus('먼저 작업 폴더를 열어 주세요.')
      return
    }
    const parent = getWorkspaceTargetDirectory()
    if (!parent) return
    try {
      const path = await invokeTauri<string>('create_workspace_file', {
        root: workspace.root,
        parent,
        name: '새 문서.md',
      })
      await loadWorkspace(workspace.root, { silent: true })
      setExpandedFolders((current) => new Set(current).add(parent))
      await openDocumentPath(path)
      setStatus(`${basename(path)} 생성됨`)
    } catch (error) {
      setStatus(`파일 생성 실패: ${String(error)}`)
    }
  }, [getWorkspaceTargetDirectory, loadWorkspace, openDocumentPath, workspace])

  const createWorkspaceFolder = useCallback(async () => {
    if (!workspace) {
      setStatus('먼저 작업 폴더를 열어 주세요.')
      return
    }
    const parent = getWorkspaceTargetDirectory()
    if (!parent) return
    try {
      const path = await invokeTauri<string>('create_workspace_folder', {
        root: workspace.root,
        parent,
        name: '새 폴더',
      })
      await loadWorkspace(workspace.root, { silent: true })
      setExpandedFolders((current) => {
        const next = new Set(current)
        next.add(parent)
        next.add(path)
        return next
      })
      setStatus(`${basename(path)} 폴더 생성됨`)
    } catch (error) {
      setStatus(`폴더 생성 실패: ${String(error)}`)
    }
  }, [getWorkspaceTargetDirectory, loadWorkspace, workspace])

  const renameCurrentWorkspaceFile = useCallback(async () => {
    if (!workspace || !currentFilePath) {
      setStatus('이름을 바꿀 작업 폴더 파일이 없습니다.')
      return
    }
    if (!isPathInsideRoot(currentFilePath, workspace.root)) {
      setStatus('작업 폴더 안의 파일만 이름을 바꿀 수 있습니다.')
      return
    }
    const name = window.prompt('새 파일 이름', basename(currentFilePath))
    if (!name || name === basename(currentFilePath)) return
    try {
      if (dirtyRef.current) {
        await saveFile(false)
      }
      const nextPath = await invokeTauri<string>('rename_workspace_item', {
        root: workspace.root,
        path: currentFilePath,
        name,
      })
      const metadata = await readDocumentMetadataQuietly(nextPath)
      const resolvedPath = metadata?.path ?? nextPath
      tauriFilePathRef.current = resolvedPath
      setCurrentFilePath(resolvedPath)
      setFileName(basename(resolvedPath))
      setDocumentDirectory(resolvedPath)
      setKnownDocumentMetadata(metadata)
      updateActiveMainTab({
        path: resolvedPath,
        name: basename(resolvedPath),
        browserHandle: null,
        metadata,
      })
      recordRecentDocument(resolvedPath)
      setRecentDocuments((documents) =>
        documents.filter((document) => document.path !== currentFilePath)
      )
      await loadWorkspace(workspace.root, { silent: true })
      setStatus(`${basename(nextPath)}로 이름 변경됨`)
    } catch (error) {
      setStatus(`이름 변경 실패: ${String(error)}`)
    }
  }, [
    currentFilePath,
    loadWorkspace,
    readDocumentMetadataQuietly,
    recordRecentDocument,
    saveFile,
    setDocumentDirectory,
    setKnownDocumentMetadata,
    updateActiveMainTab,
    workspace,
  ])

  const moveCurrentWorkspaceFileToTrash = useCallback(async () => {
    if (!workspace || !currentFilePath) {
      setStatus('휴지통으로 이동할 작업 폴더 파일이 없습니다.')
      return
    }
    if (!isPathInsideRoot(currentFilePath, workspace.root)) {
      setStatus('작업 폴더 안의 파일만 휴지통으로 이동할 수 있습니다.')
      return
    }
    if (!window.confirm(`${basename(currentFilePath)} 파일을 휴지통으로 이동할까요?`)) {
      return
    }
    try {
      await invokeTauri<void>('move_workspace_item_to_trash', {
        root: workspace.root,
        path: currentFilePath,
      })
      setRecentDocuments((documents) =>
        documents.filter((document) => document.path !== currentFilePath)
      )
      await loadWorkspace(workspace.root, { silent: true })
      loadDocument(NEW_DOCUMENT, {
        name: '제목 없음.md',
        tauriPath: null,
        browserHandle: null,
      })
      setStatus('파일을 휴지통으로 이동함')
    } catch (error) {
      setStatus(`휴지통 이동 실패: ${String(error)}`)
    }
  }, [currentFilePath, loadDocument, loadWorkspace, workspace])

  const copyWorkspaceFileContents = useCallback(async (path: string) => {
    try {
      const text =
        path === currentFilePath
          ? getLatestMarkdown()
          : await invokeTauri<string>('read_markdown_file', { path })

      await copyTextToClipboard(text)
      setStatus(`${basename(path)} 내용 전체 복사됨`)
    } catch (error) {
      setStatus(`파일 내용 복사 실패: ${String(error)}`)
    }
  }, [currentFilePath, getLatestMarkdown])

  const startNavigationResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!navigationOpen) return
    event.preventDefault()

    const shell = appShellRef.current
    const workspaceRect = workspaceRef.current?.getBoundingClientRect()
    const left = workspaceRect?.left ?? 0
    const top = workspaceRect?.top ?? 0
    const height = workspaceRect?.height ?? window.innerHeight
    const maxWidth = workspaceRect
      ? Math.min(MAX_NAVIGATION_WIDTH, Math.max(MIN_NAVIGATION_WIDTH, workspaceRect.width - 360))
      : MAX_NAVIGATION_WIDTH
    let nextWidth = navigationWidth

    const updateWidth = (clientX: number) => {
      nextWidth = clampNumber(clientX - left, MIN_NAVIGATION_WIDTH, maxWidth)
      shell?.style.setProperty('--resize-guide-left', `${left + nextWidth}px`)
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      updateWidth(moveEvent.clientX)
    }

    const finishResize = () => {
      shell?.style.setProperty('--navigation-width', `${nextWidth}px`)
      setNavigationWidth(nextWidth)
      document.body.classList.remove('is-resizing-layout')
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
    }

    document.body.classList.add('is-resizing-layout')
    shell?.style.setProperty('--resize-guide-top', `${top}px`)
    shell?.style.setProperty('--resize-guide-height', `${height}px`)
    updateWidth(event.clientX)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
  }, [navigationOpen, navigationWidth])

  const startOutlineResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!outlineOpen) return
    event.preventDefault()

    const shell = appShellRef.current
    const workspaceRect = workspaceRef.current?.getBoundingClientRect()
    if (!workspaceRect) return

    const top = workspaceRect.top
    const right = workspaceRect.right
    const height = workspaceRect.height
    const maxWidth = Math.min(
      MAX_OUTLINE_WIDTH,
      Math.max(MIN_OUTLINE_WIDTH, workspaceRect.width - 420)
    )
    let nextWidth = outlineWidth

    const updateWidth = (clientX: number) => {
      nextWidth = clampNumber(right - clientX, MIN_OUTLINE_WIDTH, maxWidth)
      shell?.style.setProperty('--resize-guide-left', `${right - nextWidth}px`)
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      updateWidth(moveEvent.clientX)
    }

    const finishResize = () => {
      shell?.style.setProperty('--outline-width', `${nextWidth}px`)
      setOutlineWidth(nextWidth)
      document.body.classList.remove('is-resizing-layout')
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
    }

    document.body.classList.add('is-resizing-layout')
    shell?.style.setProperty('--resize-guide-top', `${top}px`)
    shell?.style.setProperty('--resize-guide-height', `${height}px`)
    updateWidth(event.clientX)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
  }, [outlineOpen, outlineWidth])

  const startSourceSplitResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!sourceMode || sourceOnlyMode) return
    event.preventDefault()

    const paper = event.currentTarget.closest('.editor-paper')
    const rect = paper?.getBoundingClientRect()
    if (!rect) return
    const shell = appShellRef.current
    let nextSplit = sourceSplitPercent

    const updateSplit = (clientX: number) => {
      const percent = ((clientX - rect.left) / rect.width) * 100
      nextSplit = clampNumber(percent, MIN_SOURCE_SPLIT, MAX_SOURCE_SPLIT)
      shell?.style.setProperty(
        '--resize-guide-left',
        `${rect.left + (rect.width * nextSplit) / 100}px`
      )
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      updateSplit(moveEvent.clientX)
    }

    const finishResize = () => {
      shell?.style.setProperty('--source-split', `${nextSplit}%`)
      setSourceSplitPercent(nextSplit)
      document.body.classList.remove('is-resizing-layout')
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
    }

    document.body.classList.add('is-resizing-layout')
    shell?.style.setProperty('--resize-guide-top', `${rect.top}px`)
    shell?.style.setProperty('--resize-guide-height', `${rect.height}px`)
    updateSplit(event.clientX)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
  }, [sourceMode, sourceOnlyMode, sourceSplitPercent])

  const startCmuxPaneResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!cmuxPaneOpen) return
    event.preventDefault()

    const shell = appShellRef.current
    const splitRoot = event.currentTarget.closest('.cmux-workspace')
    const rect = splitRoot?.getBoundingClientRect()
    if (!rect) return
    let nextSplit = cmuxPaneSplitPercent

    const updateSplit = (clientX: number) => {
      const percent = ((clientX - rect.left) / rect.width) * 100
      nextSplit = clampNumber(percent, MIN_CMUX_PANE_SPLIT, MAX_CMUX_PANE_SPLIT)
      shell?.style.setProperty(
        '--resize-guide-left',
        `${rect.left + (rect.width * nextSplit) / 100}px`
      )
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      updateSplit(moveEvent.clientX)
    }

    const finishResize = () => {
      shell?.style.setProperty('--cmux-pane-split', `${nextSplit}%`)
      setCmuxPaneSplitPercent(nextSplit)
      document.body.classList.remove('is-resizing-layout')
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
    }

    document.body.classList.add('is-resizing-layout')
    shell?.style.setProperty('--resize-guide-top', `${rect.top}px`)
    shell?.style.setProperty('--resize-guide-height', `${rect.height}px`)
    updateSplit(event.clientX)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
  }, [cmuxPaneOpen, cmuxPaneSplitPercent])

  const visualDisabled = !editorReady || sourceMode
  const showMainTabbar = mainTabs.length > 1
  const layoutStyle = {
    '--navigation-width': `${navigationWidth}px`,
    '--outline-width': `${outlineWidth}px`,
    '--source-split': `${sourceSplitPercent}%`,
    '--cmux-pane-split': `${cmuxPaneSplitPercent}%`,
  } as React.CSSProperties
  const runTableToolbarCommand = (
    event: React.MouseEvent<HTMLButtonElement>,
    command: { key: unknown },
    payload?: unknown
  ) => {
    event.preventDefault()
    event.stopPropagation()
    runCommand(command, payload)
  }
  const updateCurrentCodeBlockLanguage = (language: string) => {
    const editor = editorRef.current
    if (!editor || sourceModeRef.current) return

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const block = getCodeBlockSelectionInfo(view.state.selection)
      if (!block) {
        setStatus('코드 블록 안에 커서를 둔 뒤 언어를 선택하세요.')
        return
      }

      const node = view.state.doc.nodeAt(block.pos)
      if (!node) return

      const nextLanguage = language.trim().toLowerCase()
      if (nextLanguage === block.language) return

      view.dispatch(
        view.state.tr.setNodeMarkup(block.pos, undefined, {
          ...node.attrs,
          language: nextLanguage,
        })
      )
      setActiveCodeLanguage(nextLanguage)
      setStatus(nextLanguage ? `${nextLanguage} 하이라이트 적용` : '자동 하이라이트 적용')
    })
  }
  const alignCurrentTableSelection = (
    event: React.MouseEvent<HTMLButtonElement>,
    alignment: 'left' | 'center' | 'right'
  ) => {
    event.preventDefault()
    event.stopPropagation()

    const editor = editorRef.current
    if (!editor || sourceModeRef.current) return

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { selection } = view.state

      try {
        const rect = selectedRect(view.state)
        const columnRect = {
          left: rect.left,
          right: rect.right,
          top: 0,
          bottom: rect.map.height,
        }
        const seenPositions = new Set<number>()
        const tr = view.state.tr

        rect.map.cellsInRect(columnRect).forEach((relativeCellPos) => {
          const pos = rect.tableStart + relativeCellPos
          if (seenPositions.has(pos)) return
          seenPositions.add(pos)

          const node = view.state.doc.nodeAt(pos)
          if (!node || (node.type.name !== 'table_cell' && node.type.name !== 'table_header')) {
            return
          }
          if (node.attrs.alignment === alignment) return

          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            alignment,
          })
        })

        if (tr.docChanged) {
          view.dispatch(tr.scrollIntoView())
        }
        view.focus()
        return
      } catch {
        // Fall back to Milkdown's table command if the current selection cannot be mapped.
      }

      editor.action(callCommand(setAlignCommand.key as never, alignment as never))
      view.focus()
    })
  }

  return (
    <main
      ref={appShellRef}
      className={[
        'app-shell',
        typewriterMode ? 'typewriter-mode' : '',
        navigationOpen ? 'navigation-is-open' : '',
        outlineOpen ? 'outline-is-open' : '',
        formatbarVisible ? 'formatbar-is-visible' : 'formatbar-is-hidden',
        `view-density-${viewDensity}`,
      ].join(' ')}
      style={layoutStyle}
    >
      <div className="layout-resize-guide" aria-hidden="true" />
      <header className="titlebar">
        <div className="document-identity">
          <strong>{fileName}</strong>
          {dirty && <span className="dirty-dot" title="저장하지 않은 변경사항" />}
          {externalFileChanged && <span className="external-change-dot" title="외부에서 변경된 문서" />}
          {externalFileChanged && (
            <button
              type="button"
              className="external-change-badge"
              onClick={() => void reloadCurrentDocument()}
              title="외부에서 변경된 문서를 다시 불러오기"
            >
              외부 변경됨
            </button>
          )}
        </div>
        <div className="file-actions">
          <button
            type="button"
            className="titlebar-icon-button"
            onClick={newDocument}
            title="새 문서 (⌘N)"
            aria-label="새 문서"
            data-tooltip="새 문서"
          >
            <AppIcon name="file-plus" className="titlebar-tool-icon" />
          </button>
          <button
            type="button"
            className="titlebar-icon-button"
            onClick={() => void openFile()}
            title="열기 (⌘O)"
            aria-label="파일 열기"
            data-tooltip="열기"
          >
            <AppIcon name="folder-open" className="titlebar-tool-icon" />
          </button>
          <button
            type="button"
            className={`titlebar-icon-button ${externalFileChanged ? 'needs-reload' : ''}`}
            onClick={() => void reloadCurrentDocument()}
            disabled={!currentFilePath}
            title="문서 다시 불러오기"
            aria-label="문서 다시 불러오기"
            data-tooltip="다시 불러오기"
          >
            <AppIcon name="reload" className="titlebar-tool-icon" />
          </button>
          <button
            type="button"
            className="titlebar-icon-button"
            onClick={() => void saveFile(false)}
            title="저장 (⌘S)"
            aria-label="저장"
            data-tooltip="저장"
          >
            <AppIcon name="save" className="titlebar-tool-icon" />
          </button>
          <button
            type="button"
            className={`titlebar-icon-button ${sourceMode ? 'is-active' : ''}`}
            onClick={toggleSourceMode}
            disabled={!editorReady}
            title="원문 보기/편집 (⌘/)"
            aria-label="원문 보기/편집"
            data-tooltip="원문"
          >
            <AppIcon name="source" className="titlebar-tool-icon" />
          </button>
          <button
            type="button"
            className={`titlebar-icon-button ${navigationOpen ? 'is-active' : ''}`}
            onClick={() => setNavigationOpen((value) => !value)}
            title="파일 탐색기"
            aria-label="파일 탐색기"
            data-tooltip="탐색"
          >
            <AppIcon name="panel-left" className="titlebar-tool-icon" />
          </button>
          <button
            type="button"
            className={`titlebar-icon-button ${outlineOpen ? 'is-active' : ''}`}
            onClick={() => setOutlineOpen((value) => !value)}
            disabled={!editorReady || sourceOnlyMode}
            title="문서 목차"
            aria-label="문서 목차"
            data-tooltip="목차"
          >
            <AppIcon name="toc" className="titlebar-tool-icon" />
          </button>
          <button
            type="button"
            className={`titlebar-icon-button formatbar-toggle ${formatbarVisible ? 'is-active' : ''}`}
            onClick={() => setFormatbarVisible((value) => !value)}
            title={formatbarVisible ? '상단 서식바 숨기기' : '상단 서식바 보이기'}
            aria-label={formatbarVisible ? '상단 서식바 숨기기' : '상단 서식바 보이기'}
            data-tooltip={formatbarVisible ? '툴바 숨김' : '툴바 보임'}
          >
            <AppIcon
              name={formatbarVisible ? 'panel-top-close' : 'panel-top-open'}
              className="titlebar-tool-icon"
            />
          </button>
          <div className="theme-picker" ref={themePickerRef}>
            <button
              type="button"
              className="theme-picker-button"
              title="색 테마 선택"
              aria-label="색 테마 선택"
              aria-haspopup="listbox"
              aria-expanded={themePickerOpen}
              data-tooltip="테마 선택"
              onClick={() => setThemePickerOpen((value) => !value)}
            >
              <AppIcon name="palette" className="theme-picker-icon" />
              <span className="theme-picker-label">{currentThemeOption.label}</span>
              <AppIcon
                name="chevron-down"
                className={`theme-picker-chevron ${themePickerOpen ? 'is-open' : ''}`}
              />
            </button>
            {themePickerOpen && (
              <div className="theme-menu" role="listbox" aria-label="색 테마 선택">
                {THEME_OPTIONS.map((option) => {
                  const selected = option.value === themeMode
                  return (
                    <button
                      type="button"
                      key={option.value}
                      className={`theme-option ${selected ? 'is-selected' : ''}`}
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        setThemeMode(option.value)
                        setThemePickerOpen(false)
                      }}
                    >
                      <span
                        className="theme-option-swatch"
                        data-theme-option={option.value}
                        aria-hidden="true"
                      />
                      <span className="theme-option-label">{option.label}</span>
                      {selected && <AppIcon name="check" className="theme-option-check" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="formatbar" role="toolbar" aria-label="서식 도구">
        <div className="toolbar-group">
          <ToolbarButton title="실행 취소" disabled={visualDisabled} onAction={() => runCommand(undoCommand)}>
            <AppIcon name="undo" className="toolbar-svg-icon" />
          </ToolbarButton>
          <ToolbarButton title="다시 실행" disabled={visualDisabled} onAction={() => runCommand(redoCommand)}>
            <AppIcon name="redo" className="toolbar-svg-icon" />
          </ToolbarButton>
        </div>

        <div className="toolbar-separator" />

        <div className="toolbar-group text-size-tools" aria-label="글자 크기">
          <ToolbarButton title="본문 크기" disabled={visualDisabled} onAction={() => runCommand(turnIntoTextCommand)}>
            <AppIcon name="text" className="toolbar-svg-icon" />
          </ToolbarButton>
          <ToolbarButton title="큰 글자 (제목 1)" disabled={visualDisabled} onAction={() => runCommand(wrapInHeadingCommand, 1)}>
            <AppIcon name="heading-1" className="toolbar-svg-icon" />
          </ToolbarButton>
          <ToolbarButton title="중간 글자 (제목 2)" disabled={visualDisabled} onAction={() => runCommand(wrapInHeadingCommand, 2)}>
            <AppIcon name="heading-2" className="toolbar-svg-icon" />
          </ToolbarButton>
          <ToolbarButton title="작은 제목 (제목 3)" disabled={visualDisabled} onAction={() => runCommand(wrapInHeadingCommand, 3)}>
            <AppIcon name="heading-3" className="toolbar-svg-icon" />
          </ToolbarButton>
        </div>

        <div className="toolbar-separator" />

        <div className="toolbar-group text-mark-tools" aria-label="글자 모양">
          <ToolbarButton title="굵게 (⌘B)" disabled={visualDisabled} onAction={() => runCommand(toggleStrongCommand)}>
            <AppIcon name="bold" className="toolbar-svg-icon" />
          </ToolbarButton>
          <ToolbarButton title="기울임 (⌘I)" disabled={visualDisabled} onAction={() => runCommand(toggleEmphasisCommand)}>
            <AppIcon name="italic" className="toolbar-svg-icon" />
          </ToolbarButton>
          <ToolbarButton title="취소선" disabled={visualDisabled} onAction={() => runCommand(toggleStrikethroughCommand)}>
            <AppIcon name="strike" className="toolbar-svg-icon" />
          </ToolbarButton>
          <ToolbarButton title="인라인 코드" disabled={visualDisabled} onAction={() => runCommand(toggleInlineCodeCommand)}>
            <AppIcon name="source" className="toolbar-svg-icon" />
          </ToolbarButton>
        </div>

        <div className="toolbar-separator" />

        <div className="toolbar-group">
          <ToolbarButton title="글머리 목록" disabled={visualDisabled} onAction={() => runCommand(wrapInBulletListCommand)}>
            <AppIcon name="bullet-list" className="toolbar-svg-icon" />
          </ToolbarButton>
          <ToolbarButton title="번호 목록" disabled={visualDisabled} onAction={() => runCommand(wrapInOrderedListCommand)}>
            <AppIcon name="ordered-list" className="toolbar-svg-icon" />
          </ToolbarButton>
          <ToolbarButton title="인용문" disabled={visualDisabled} onAction={() => runCommand(wrapInBlockquoteCommand)}>
            <AppIcon name="quote" className="toolbar-svg-icon" />
          </ToolbarButton>
          <ToolbarButton title="코드 블록" disabled={visualDisabled} onAction={() => runCommand(createCodeBlockCommand, '')}>
            <AppIcon name="code-block" className="toolbar-svg-icon" />
          </ToolbarButton>
          <select
            className="toolbar-code-language-select"
            title="코드 언어"
            aria-label="코드 언어"
            disabled={visualDisabled || activeCodeLanguage === null}
            value={activeCodeLanguage ?? ''}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => updateCurrentCodeBlockLanguage(event.currentTarget.value)}
          >
            {activeCodeLanguage &&
              !CODE_LANGUAGE_OPTIONS.some((option) => option.value === activeCodeLanguage) && (
                <option value={activeCodeLanguage}>{activeCodeLanguage}</option>
              )}
            {CODE_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value || 'auto'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ToolbarButton title="구분선" disabled={visualDisabled} onAction={() => runCommand(insertHrCommand)}>
            <AppIcon name="horizontal-rule" className="toolbar-svg-icon" />
          </ToolbarButton>
        </div>

        <div className="toolbar-separator" />

        <div className="toolbar-group table-tools" aria-label="표 도구">
          <ToolbarButton title="3×3 표" disabled={visualDisabled} onAction={() => runCommand(insertTableCommand, { row: 3, col: 3 })}>
            <AppIcon name="table" className="toolbar-svg-icon" />
          </ToolbarButton>
          <ToolbarButton title="아래 행 추가" disabled={visualDisabled} onAction={() => runCommand(addRowAfterCommand)}>
            <AppIcon name="table-row-add" className="toolbar-svg-icon" />
          </ToolbarButton>
          <ToolbarButton title="오른쪽 열 추가" disabled={visualDisabled} onAction={() => runCommand(addColAfterCommand)}>
            <AppIcon name="table-column-add" className="toolbar-svg-icon" />
          </ToolbarButton>
        </div>

        <div className="toolbar-separator" />

        <div className="toolbar-group">
          <ToolbarButton title="링크" disabled={visualDisabled} onAction={addLink}>
            <AppIcon name="link" className="toolbar-svg-icon" />
          </ToolbarButton>
          <ToolbarButton title="이미지" disabled={visualDisabled} onAction={addImage}>
            <AppIcon name="image" className="toolbar-svg-icon" />
          </ToolbarButton>
          <ToolbarButton
            title="Mermaid 다이어그램"
            disabled={visualDisabled}
            onAction={() =>
              insertMarkdown(
                '```mermaid\nflowchart TD\n  A[시작] --> B[완료]\n```'
              )
            }
          >
            <AppIcon name="mermaid" className="toolbar-svg-icon" />
          </ToolbarButton>
          <ToolbarButton
            title="블록 수식"
            disabled={visualDisabled}
            onAction={() => insertMarkdown('$$\nE = mc^2\n$$')}
          >
            <AppIcon name="math" className="toolbar-svg-icon" />
          </ToolbarButton>
        </div>

        <div className="toolbar-spacer" />
      </div>

      <section className="workspace" ref={workspaceRef}>
        {documentSearchOpen && (
          <div className="document-search-popover" role="search">
            <input
              ref={documentSearchInputRef}
              type="search"
              value={documentSearchQuery}
              placeholder="문서 검색"
              aria-label="현재 문서 검색"
              onChange={(event) => {
                const value = event.target.value
                setDocumentSearchQuery(value)
                runDocumentSearch(value, 0, true)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  runDocumentSearch(event.currentTarget.value, event.shiftKey ? -1 : 1, true)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  closeDocumentSearch()
                }
              }}
            />
            <span className="document-search-count">
              {documentSearchQuery.trim() && documentSearchCount > 0
                ? `${documentSearchIndex + 1}/${documentSearchCount}`
                : '0/0'}
            </span>
            <button
              type="button"
              aria-label="이전 검색 결과"
              title="이전 검색 결과 (Shift+Enter)"
              onClick={() => runDocumentSearch(documentSearchQuery, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="다음 검색 결과"
              title="다음 검색 결과 (Enter)"
              onClick={() => runDocumentSearch(documentSearchQuery, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="검색 닫기"
              title="검색 닫기 (Esc)"
              onClick={closeDocumentSearch}
            >
              ×
            </button>
          </div>
        )}
        <WorkspaceSidebar
          activeTab={sidebarTab}
          onTabChange={setSidebarTab}
          workspace={workspace}
          workspaceLoading={workspaceLoading}
          currentFilePath={currentFilePath}
          expandedFolders={expandedFolders}
          onToggleFolder={toggleWorkspaceFolder}
          onOpenWorkspace={() => void openWorkspace()}
          onRefreshWorkspace={() => void refreshWorkspace()}
          onCloseWorkspace={closeWorkspace}
          onOpenFile={(path) => void openDocumentPath(path)}
          onOpenFileInNewTab={(path) => void openDocumentPathInNewTab(path)}
          onOpenFileInRightPane={(path) => void openDocumentInRightPane(path)}
          onOpenFileInNewWindow={(path) => void openDocumentInNewWindow(path)}
          onCreateFile={() => void createWorkspaceFile()}
          onCreateFolder={() => void createWorkspaceFolder()}
          onRenameCurrent={() => void renameCurrentWorkspaceFile()}
          onDeleteCurrent={() => void moveCurrentWorkspaceFileToTrash()}
          onRevealPath={(path) => void revealPathInFinder(path)}
          onCopyFileContents={(path) => void copyWorkspaceFileContents(path)}
          recentDocuments={recentDocuments}
          onClearRecentDocuments={clearRecentDocuments}
          onRemoveRecentDocument={removeRecentDocument}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          searchResults={searchResults}
          searching={searching}
          onOpenSearchResult={(result) => void openSearchResult(result)}
        />
        {navigationOpen && (
          <div
            className="navigation-resizer"
            role="separator"
            aria-label="파일 리스트 너비 조절"
            aria-orientation="vertical"
            title="파일 리스트 너비 조절"
            onPointerDown={startNavigationResize}
          />
        )}

        <div className={`cmux-workspace ${cmuxPaneOpen ? 'has-right-pane' : ''}`}>
          <section className="cmux-pane cmux-main-pane" aria-label="편집 패널">
            {showMainTabbar && (
              <div className="cmux-tabbar" role="tablist" aria-label="편집 문서 탭">
                <div className="cmux-tabs">
                  {mainTabs.map((tab) => {
                    const active = tab.id === activeMainTabId
                    const tabDirty = active ? dirty || tab.dirty : tab.dirty
                    return (
                      <div
                        key={tab.id}
                        className={`cmux-tab ${active ? 'is-active' : ''}`}
                      >
                        <button
                          type="button"
                          className="cmux-tab-label"
                          role="tab"
                          aria-selected={active}
                          title={tab.path ?? tab.name}
                          onClick={() => {
                            void switchMainTab(tab.id)
                          }}
                        >
                          <span>{tab.name}</span>
                          {tabDirty && <span className="cmux-tab-dirty" aria-hidden="true" />}
                        </button>
                        <button
                          type="button"
                          className="cmux-tab-close"
                          aria-label={`${tab.name} 탭 닫기`}
                          title="탭 닫기"
                          onClick={(event) => {
                            event.stopPropagation()
                            closeMainTab(tab.id)
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>
                <div className="cmux-tabbar-actions">
                  <button
                    type="button"
                    className="cmux-icon-button"
                    aria-label="현재 문서를 오른쪽 패널에서 편집"
                    title="오른쪽 패널에서 편집"
                    disabled={!currentFilePath}
                    onClick={() => void openDocumentInRightPane()}
                  >
                    <AppIcon name="panel-right" className="cmux-action-icon" />
                  </button>
                </div>
              </div>
            )}

            <div
              className={[
                'editor-scroll',
                sourceOnlyMode ? 'source-only-scroll' : '',
                sourceMode && !sourceOnlyMode ? 'source-compare-scroll' : '',
              ].join(' ')}
            >
              <article
                ref={editorPaperRef}
                className={`editor-paper ${sourceMode ? 'show-source' : ''} ${sourceOnlyMode ? 'source-only' : ''}`}
              >
                {tableToolbar && !sourceMode && (
                  <div
                    className="table-floating-toolbar"
                    role="toolbar"
                    aria-label="표 편집"
                    style={{
                      left: tableToolbar.left,
                      top: tableToolbar.top,
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <button
                      type="button"
                      title="아래 행 추가"
                      aria-label="아래 행 추가"
                      onMouseDown={(event) => runTableToolbarCommand(event, addRowAfterCommand)}
                    >
                      <AppIcon name="table-row-add" className="table-tool-icon" />
                    </button>
                    <button
                      type="button"
                      title="오른쪽 열 추가"
                      aria-label="오른쪽 열 추가"
                      onMouseDown={(event) => runTableToolbarCommand(event, addColAfterCommand)}
                    >
                      <AppIcon name="table-column-add" className="table-tool-icon" />
                    </button>
                    <span className="table-toolbar-separator" />
                    <button
                      type="button"
                      title="왼쪽 정렬"
                      aria-label="왼쪽 정렬"
                      onMouseDown={(event) => alignCurrentTableSelection(event, 'left')}
                    >
                      <AppIcon name="align-left" className="table-tool-icon" />
                    </button>
                    <button
                      type="button"
                      title="가운데 정렬"
                      aria-label="가운데 정렬"
                      onMouseDown={(event) => alignCurrentTableSelection(event, 'center')}
                    >
                      <AppIcon name="align-center" className="table-tool-icon" />
                    </button>
                    <button
                      type="button"
                      title="오른쪽 정렬"
                      aria-label="오른쪽 정렬"
                      onMouseDown={(event) => alignCurrentTableSelection(event, 'right')}
                    >
                      <AppIcon name="align-right" className="table-tool-icon" />
                    </button>
                    <span className="table-toolbar-separator" />
                    <button
                      type="button"
                      title="선택한 표 영역 삭제"
                      aria-label="선택한 표 영역 삭제"
                      onMouseDown={(event) => runTableToolbarCommand(event, deleteSelectedCellsCommand)}
                    >
                      <AppIcon name="trash" className="table-tool-icon" />
                    </button>
                  </div>
                )}
                <div
                  ref={hostRef}
                  className="milkdown-host"
                  aria-label="렌더링된 Markdown 문서"
                />
                {sourceMode && (
                  <>
                    {!sourceOnlyMode && (
                      <div
                        className="source-split-resizer"
                        role="separator"
                        aria-label="문서와 원문 너비 조절"
                        aria-orientation="vertical"
                        title="문서와 원문 너비 조절"
                        onPointerDown={startSourceSplitResize}
                      />
                    )}
                    <div className={`source-editor-shell ${sourceHighlightActive ? 'has-highlight' : ''} ${sourceOnlyMode ? 'source-nowrap' : ''}`}>
                      {sourceHighlightActive && (
                        <pre
                          ref={sourceHighlightRef}
                          className="source-highlight"
                          aria-hidden="true"
                        >
                          <code>{sourceHighlightContent}</code>
                        </pre>
                      )}
                      <textarea
                        ref={sourceEditorRef}
                        className={`source-editor ${sourceHighlightActive ? 'source-editor-with-highlight' : ''}`}
                        value={sourceDraft}
                        wrap={sourceOnlyMode ? 'off' : 'soft'}
                        spellCheck={false}
                        aria-label={sourceOnlyMode ? '원문 편집' : 'Markdown 원문'}
                        onSelect={handleSourceCursorActivity}
                        onKeyUp={handleSourceCursorActivity}
                        onMouseUp={handleSourceCursorActivity}
                        onFocus={handleSourceEditorFocus}
                        onBlur={handleSourceEditorBlur}
                        onScroll={handleSourcePaneScroll}
                        onChange={(event) => {
                          const value = event.target.value
                          sourceDraftRef.current = value
                          setSourceDraft(value)
                          if (!sourceOnlyMode) {
                            syncSourcePreview()
                          }
                          const nextDirty = value !== lastSavedTextRef.current
                          updateActiveMainTabText(value, nextDirty)
                          if (dirtyRef.current !== nextDirty) {
                            dirtyRef.current = nextDirty
                            setDirty(nextDirty)
                          }
                          const nextStatus = sourceOnlyMode ? '원문 편집' : 'Markdown 원문 편집'
                          if (statusRef.current !== nextStatus) {
                            statusRef.current = nextStatus
                            setStatus(nextStatus)
                          }
                          if (nextDirty) scheduleAutoSave(value)
                        }}
                      />
                    </div>
                  </>
                )}
              </article>
            </div>
          </section>

          {cmuxPaneOpen && (
            <>
              <div
                className="cmux-pane-resizer"
                role="separator"
                aria-label="문서 패널 너비 조절"
                aria-orientation="vertical"
                title="문서 패널 너비 조절"
                onPointerDown={startCmuxPaneResize}
              />
              <aside className="cmux-pane cmux-side-pane" aria-label="오른쪽 문서 패널">
                <div className="cmux-tabbar cmux-side-tabbar" role="tablist" aria-label="오른쪽 문서 탭">
                  <div className="cmux-tabs">
                    {rightPaneTabs.map((document) => {
                      const active = document.path === rightPaneActiveDocument?.path
                      return (
                        <div
                          key={document.path}
                          className={`cmux-tab ${active ? 'is-active' : ''}`}
                        >
                          <button
                            type="button"
                            className="cmux-tab-label"
                            role="tab"
                            aria-selected={active}
                            title={document.path}
                            onClick={() => activateRightPaneDocument(document.path)}
                          >
                            <span>{document.name}</span>
                            {document.dirty && <span className="cmux-tab-dirty" aria-hidden="true" />}
                          </button>
                          <button
                            type="button"
                            className="cmux-tab-close"
                            aria-label={`${document.name} 탭 닫기`}
                            title="탭 닫기"
                            onClick={(event) => {
                              event.stopPropagation()
                              closeRightPaneTab(document.path)
                            }}
                          >
                            ×
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  <div className="cmux-tabbar-actions">
                    <button
                      type="button"
                      className="cmux-icon-button"
                      aria-label="오른쪽 패널 저장"
                      title="저장"
                      onClick={() => void saveRightPaneDocument()}
                    >
                      <AppIcon name="save" className="cmux-action-icon" />
                    </button>
                    <button
                      type="button"
                      className="cmux-icon-button"
                      aria-label="오른쪽 패널 다시 불러오기"
                      title="다시 불러오기"
                      onClick={() => void reloadRightPaneDocument()}
                    >
                      <AppIcon name="reload" className="cmux-action-icon" />
                    </button>
                    <button
                      type="button"
                      className="cmux-icon-button"
                      aria-label="오른쪽 패널 닫기"
                      title="패널 닫기"
                      onClick={closeRightPane}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="cmux-side-body">
                  {rightPaneActiveDocument && (
                    <>
                      <div className="cmux-side-meta">
                        <strong>{rightPaneActiveDocument.name}</strong>
                        <span>
                          {rightPaneStats
                            ? `${rightPaneStats.lines.toLocaleString()}줄 · ${rightPaneStats.characters.toLocaleString()}자`
                            : rightPaneActiveDocument.path}
                          {rightPaneActiveDocument.dirty ? ' · 저장 안 됨' : ''}
                        </span>
                      </div>
                      <div className="cmux-side-editor-scroll">
                        <CmuxPaneEditor
                          key={rightPaneActiveDocument.path}
                          document={rightPaneActiveDocument}
                          onChange={updateRightPaneDocumentText}
                        />
                      </div>
                    </>
                  )}
                </div>
              </aside>
            </>
          )}
        </div>
        {outlineOpen && (
          <div
            className="outline-resizer"
            role="separator"
            aria-label="목차 너비 조절"
            aria-orientation="vertical"
            title="목차 너비 조절"
            onPointerDown={startOutlineResize}
          />
        )}
        <aside className="outline-panel" aria-hidden={!outlineOpen}>
          <div className="outline-title">
            <AppIcon name="toc" className="outline-title-icon" />
            <span>문서 목차</span>
          </div>
          <nav>
            {outline.length === 0 ? (
              <p className="outline-empty">제목을 추가하면 여기에 표시됩니다.</p>
            ) : (
              outline.map((item, index) => (
                <button
                  type="button"
                  key={`${item.pos}-${index}`}
                  className={item.pos === activeOutlinePos ? 'is-active' : ''}
                  style={{ '--outline-level': item.level } as React.CSSProperties}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => jumpToOutline(item)}
                >
                  {item.text}
                </button>
              ))
            )}
          </nav>
        </aside>
      </section>

      <footer className="statusbar">
        <span className="status-message">{status}</span>
        {workspace && <span className="workspace-status">{workspace.name}</span>}
        <span className="status-spacer" />
        <div className="view-density-toggle" role="group" aria-label="문서 보기 간격">
          <button
            type="button"
            className={viewDensity === 'normal' ? 'is-active' : ''}
            aria-pressed={viewDensity === 'normal'}
            title="기본 보기"
            onClick={() => setViewDensity('normal')}
          >
            기본
          </button>
          <button
            type="button"
            className={viewDensity === 'compact' ? 'is-active' : ''}
            aria-pressed={viewDensity === 'compact'}
            title="컴팩트 보기"
            onClick={() => setViewDensity('compact')}
          >
            컴팩트
          </button>
        </div>
        <label className="autosave-toggle">
          <input
            type="checkbox"
            checked={autoSaveEnabled}
            onChange={(event) => setAutoSaveEnabled(event.target.checked)}
          />
          자동 저장
        </label>
        <span>{stats.words.toLocaleString()}단어</span>
        <span>{stats.characters.toLocaleString()}자</span>
        <span>{stats.lines.toLocaleString()}줄</span>
        <span>{stats.minutes}분 읽기</span>
        <span className="app-version">v{__APP_VERSION__}</span>
      </footer>
    </main>
  )
}
