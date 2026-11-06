import React, { useEffect, useMemo, useState } from 'react'
import type {
  RecentDocument,
  SearchMatch,
  SidebarTab,
  WorkspaceNode,
  WorkspaceSnapshot,
} from '../workspace-types'

type WorkspaceSidebarProps = {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  workspace: WorkspaceSnapshot | null
  workspaceLoading: boolean
  currentFilePath: string | null
  expandedFolders: Set<string>
  onToggleFolder: (path: string) => void
  onOpenWorkspace: () => void
  onRefreshWorkspace: () => void
  onCloseWorkspace: () => void
  onOpenFile: (path: string) => void
  onOpenFileInNewTab: (path: string) => void
  onOpenFileInRightPane: (path: string) => void
  onOpenFileInNewWindow: (path: string) => void
  onCreateFile: () => void
  onCreateFolder: () => void
  onRenameCurrent: () => void
  onDeleteCurrent: () => void
  onRevealPath: (path: string) => void
  onCopyFileContents: (path: string) => void
  recentDocuments: RecentDocument[]
  onClearRecentDocuments: () => void
  onRemoveRecentDocument: (path: string) => void
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  searchResults: SearchMatch[]
  searching: boolean
  onOpenSearchResult: (result: SearchMatch) => void
}

type SidebarIconName =
  | 'file-add'
  | 'folder-add'
  | 'rename'
  | 'trash'
  | 'refresh'
  | 'folder-open'
  | 'close'
  | 'title'

const SIDEBAR_ICON_MAP: Record<SidebarIconName, string> = {
  'file-add': 'note_add',
  'folder-add': 'create_new_folder',
  rename: 'edit',
  trash: 'delete',
  refresh: 'refresh',
  'folder-open': 'folder_open',
  close: 'close',
  title: 'article',
}

const FILE_TITLE_DISPLAY_KEY = 'markflow.file-title-display.v1'
const FILE_FILTER_KEY = 'markflow.file-filter.v1'
const MARKDOWN_FILE_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd'])
const CODE_FILE_EXTENSIONS = new Set([
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'css',
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
])
const WEB_FILE_EXTENSIONS = new Set(['html', 'htm', 'xml', 'svg'])
const DATA_FILE_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'toml', 'csv'])
const TEXT_FILE_EXTENSIONS = new Set(['txt', 'log'])
const FILE_FILTERS = [
  { value: 'all', label: '전체', title: '모든 지원 파일 표시' },
  { value: 'markdown', label: 'MD', title: 'Markdown 파일만 표시' },
  { value: 'code', label: '코드', title: '코드 파일만 표시' },
  { value: 'web', label: '웹', title: 'HTML/XML/SVG 파일만 표시' },
  { value: 'data', label: '데이터', title: 'JSON/YAML/CSV 파일만 표시' },
  { value: 'text', label: '텍스트', title: '텍스트/로그 파일만 표시' },
] as const

type FileListFilter = (typeof FILE_FILTERS)[number]['value']

function readFileTitleDisplay() {
  try {
    return window.localStorage.getItem(FILE_TITLE_DISPLAY_KEY) === '1'
  } catch {
    return false
  }
}

function readFileFilter(): FileListFilter {
  try {
    const saved = window.localStorage.getItem(FILE_FILTER_KEY)
    if (FILE_FILTERS.some((filter) => filter.value === saved)) {
      return saved as FileListFilter
    }
  } catch {
    // 필터 저장소를 읽지 못하면 전체 파일 표시로 시작합니다.
  }
  return 'all'
}

function SidebarIcon({ name }: { name: SidebarIconName }) {
  const icon = SIDEBAR_ICON_MAP[name]

  return (
    <span className="material-symbols-outlined sidebar-action-icon" aria-hidden="true">
      {icon}
    </span>
  )
}

function TreeChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <span className="material-symbols-outlined tree-chevron-icon" aria-hidden="true">
      {expanded ? 'keyboard_arrow_down' : 'keyboard_arrow_right'}
    </span>
  )
}

function TreeFolderIcon({ expanded }: { expanded: boolean }) {
  return (
    <span
      className={`material-symbols-outlined tree-folder-icon ${expanded ? 'is-expanded' : ''}`}
      aria-hidden="true"
    >
      {expanded ? 'folder_open' : 'folder'}
    </span>
  )
}

function compactPath(path: string) {
  const pieces = path.replaceAll('\\', '/').split('/').filter(Boolean)
  if (pieces.length <= 3) return path
  return `…/${pieces.slice(-3).join('/')}`
}

function fileExtensionLabel(name: string) {
  const extension = fileExtension(name)
  if (!extension || extension === name.toLowerCase()) return 'FILE'
  if (extension === 'markdown') return 'MD'
  return extension.slice(0, 5).toUpperCase()
}

function fileExtension(name: string) {
  const extension = name.split('.').at(-1)?.trim().toLowerCase()
  return extension && extension !== name.toLowerCase() ? extension : ''
}

function fileMatchesFilter(name: string, filter: FileListFilter) {
  if (filter === 'all') return true

  const extension = fileExtension(name)
  if (!extension) return false

  if (filter === 'markdown') return MARKDOWN_FILE_EXTENSIONS.has(extension)
  if (filter === 'code') return CODE_FILE_EXTENSIONS.has(extension)
  if (filter === 'web') return WEB_FILE_EXTENSIONS.has(extension)
  if (filter === 'data') return DATA_FILE_EXTENSIONS.has(extension)
  return TEXT_FILE_EXTENSIONS.has(extension)
}

function filterWorkspaceEntries(
  entries: WorkspaceNode[],
  filter: FileListFilter
): WorkspaceNode[] {
  if (filter === 'all') return entries

  return entries.flatMap((entry) => {
    if (!entry.isDirectory) {
      return fileMatchesFilter(entry.name, filter) ? [entry] : []
    }

    const children = filterWorkspaceEntries(entry.children, filter)
    return children.length > 0 ? [{ ...entry, children }] : []
  })
}

function countWorkspaceFiles(entries: WorkspaceNode[]): number {
  return entries.reduce((count, entry) => {
    if (!entry.isDirectory) return count + 1
    return count + countWorkspaceFiles(entry.children)
  }, 0)
}

function formatOpenedAt(timestamp: number) {
  const date = new Date(timestamp)
  const today = new Date()
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()

  return new Intl.DateTimeFormat('ko-KR', {
    ...(sameDay
      ? { hour: '2-digit', minute: '2-digit' }
      : { month: 'short', day: 'numeric' }),
  }).format(date)
}

function filePathToFileUrl(path: string) {
  const normalizedPath = path.replaceAll('\\', '/')
  const encodedPath = normalizedPath
    .split('/')
    .map((part, index) => (index === 0 && part === '' ? '' : encodeURIComponent(part)))
    .join('/')

  return normalizedPath.startsWith('/') ? `file://${encodedPath}` : `file:///${encodedPath}`
}

function dragMimeType(name: string) {
  const extension = name.split('.').at(-1)?.toLowerCase() ?? ''
  if (['md', 'markdown', 'mdown', 'mkd'].includes(extension)) return 'text/markdown'
  if (extension === 'txt' || extension === 'log') return 'text/plain'
  if (extension === 'json') return 'application/json'
  if (extension === 'html') return 'text/html'
  if (extension === 'css') return 'text/css'
  if (extension === 'csv') return 'text/csv'
  if (extension === 'js') return 'text/javascript'
  if (extension === 'ts') return 'text/typescript'
  return 'application/octet-stream'
}

function setDragData(dataTransfer: DataTransfer, type: string, value: string) {
  try {
    dataTransfer.setData(type, value)
  } catch {
    // 일부 WebView는 커스텀 드래그 타입을 거부할 수 있어 가능한 타입만 사용합니다.
  }
}

function startPathDrag(
  event: React.DragEvent,
  path: string,
  name: string,
  isDirectory: boolean
) {
  const fileUrl = filePathToFileUrl(path)
  const safeName = name.replace(/[:\n\r]/g, '_')

  event.dataTransfer.effectAllowed = 'copy'
  setDragData(event.dataTransfer, 'text/uri-list', `${fileUrl}\n`)
  setDragData(event.dataTransfer, 'text/plain', path)
  setDragData(event.dataTransfer, 'text/x-moz-url', `${fileUrl}\n${name}`)

  if (!isDirectory) {
    setDragData(
      event.dataTransfer,
      'DownloadURL',
      `${dragMimeType(name)}:${safeName}:${fileUrl}`
    )
  }
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const term = query.trim().split(/\s+/).find(Boolean)
  if (!term) return <>{text}</>

  const index = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase())
  if (index < 0) return <>{text}</>

  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + term.length)}</mark>
      {text.slice(index + term.length)}
    </>
  )
}

function FileTreeNode({
  node,
  depth,
  showDocumentTitle,
  currentFilePath,
  expandedFolders,
  onToggleFolder,
  onOpenFile,
  onShowPathMenu,
}: {
  node: WorkspaceNode
  depth: number
  showDocumentTitle: boolean
  currentFilePath: string | null
  expandedFolders: Set<string>
  onToggleFolder: (path: string) => void
  onOpenFile: (path: string) => void
  onShowPathMenu: (
    event: React.MouseEvent,
    path: string,
    name: string,
    isDirectory: boolean
  ) => void
}) {
  const expanded = node.isDirectory && expandedFolders.has(node.path)
  const displayName =
    !node.isDirectory && showDocumentTitle && node.title ? node.title : node.name

  if (node.isDirectory) {
    return (
      <div className="tree-directory">
        <button
          type="button"
          className="tree-row tree-folder-row"
          style={{ '--tree-depth': depth } as React.CSSProperties}
          title={node.path}
          aria-expanded={expanded}
          draggable
          onClick={() => onToggleFolder(node.path)}
          onDragStart={(event) => startPathDrag(event, node.path, node.name, true)}
          onContextMenu={(event) =>
            onShowPathMenu(event, node.path, node.name, true)
          }
        >
          <span className="tree-chevron" aria-hidden="true">
            <TreeChevronIcon expanded={expanded} />
          </span>
          <span className="tree-node-icon" aria-hidden="true">
            <TreeFolderIcon expanded={expanded} />
          </span>
          <span className="tree-label">{node.name}</span>
        </button>
        {expanded && (
          <div className="tree-children">
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                showDocumentTitle={showDocumentTitle}
                currentFilePath={currentFilePath}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                onOpenFile={onOpenFile}
                onShowPathMenu={onShowPathMenu}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`tree-row tree-file-row ${currentFilePath === node.path ? 'is-current' : ''}`}
      style={{ '--tree-depth': depth } as React.CSSProperties}
      title={displayName === node.name ? node.path : `${displayName}\n${node.path}`}
      draggable
      onClick={() => onOpenFile(node.path)}
      onDragStart={(event) => startPathDrag(event, node.path, node.name, false)}
      onContextMenu={(event) =>
        onShowPathMenu(event, node.path, node.name, false)
      }
    >
      <span className="tree-chevron tree-chevron-spacer" aria-hidden="true" />
      <span className="tree-node-icon tree-file-kind-icon" aria-hidden="true">
        <span className="tree-extension-badge">{fileExtensionLabel(node.name)}</span>
      </span>
      <span className="tree-label">{displayName}</span>
    </button>
  )
}

export function WorkspaceSidebar({
  activeTab,
  onTabChange,
  workspace,
  workspaceLoading,
  currentFilePath,
  expandedFolders,
  onToggleFolder,
  onOpenWorkspace,
  onRefreshWorkspace,
  onCloseWorkspace,
  onOpenFile,
  onOpenFileInNewTab,
  onOpenFileInRightPane,
  onOpenFileInNewWindow,
  onCreateFile,
  onCreateFolder,
  onRenameCurrent,
  onDeleteCurrent,
  onRevealPath,
  onCopyFileContents,
  recentDocuments,
  onClearRecentDocuments,
  onRemoveRecentDocument,
  searchQuery,
  onSearchQueryChange,
  searchResults,
  searching,
  onOpenSearchResult,
}: WorkspaceSidebarProps) {
  const [showDocumentTitles, setShowDocumentTitles] = useState(readFileTitleDisplay)
  const [fileFilter, setFileFilter] = useState<FileListFilter>(readFileFilter)
  const [pathMenu, setPathMenu] = useState<{
    path: string
    name: string
    isDirectory: boolean
    x: number
    y: number
  } | null>(null)

  useEffect(() => {
    try {
      window.localStorage.setItem(FILE_TITLE_DISPLAY_KEY, showDocumentTitles ? '1' : '0')
    } catch {
      // 제목 표시 설정 저장에 실패해도 현재 세션의 표시 상태는 유지합니다.
    }
  }, [showDocumentTitles])

  useEffect(() => {
    try {
      window.localStorage.setItem(FILE_FILTER_KEY, fileFilter)
    } catch {
      // 필터 저장에 실패해도 현재 세션의 필터는 유지합니다.
    }
  }, [fileFilter])

  useEffect(() => {
    if (!pathMenu) return

    const close = () => setPathMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [pathMenu])

  const showPathMenu = (
    event: React.MouseEvent,
    path: string,
    name: string,
    isDirectory: boolean
  ) => {
    event.preventDefault()
    event.stopPropagation()

    setPathMenu({
      path,
      name,
      isDirectory,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 180)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 158)),
    })
  }

  const openMenuFileInRightPane = () => {
    if (!pathMenu || pathMenu.isDirectory) return
    onOpenFileInRightPane(pathMenu.path)
    setPathMenu(null)
  }

  const openMenuFileInNewTab = () => {
    if (!pathMenu || pathMenu.isDirectory) return
    onOpenFileInNewTab(pathMenu.path)
    setPathMenu(null)
  }

  const openMenuFileInNewWindow = () => {
    if (!pathMenu || pathMenu.isDirectory) return
    onOpenFileInNewWindow(pathMenu.path)
    setPathMenu(null)
  }

  const copyMenuFileContents = () => {
    if (!pathMenu || pathMenu.isDirectory) return
    onCopyFileContents(pathMenu.path)
    setPathMenu(null)
  }

  const revealMenuPath = () => {
    if (!pathMenu) return
    onRevealPath(pathMenu.path)
    setPathMenu(null)
  }

  const visibleEntries = useMemo(
    () => filterWorkspaceEntries(workspace?.entries ?? [], fileFilter),
    [fileFilter, workspace]
  )
  const visibleFileCount = useMemo(
    () => countWorkspaceFiles(visibleEntries),
    [visibleEntries]
  )
  const selectedFilter = FILE_FILTERS.find((filter) => filter.value === fileFilter) ?? FILE_FILTERS[0]
  const workspaceCountLabel = workspace
    ? fileFilter === 'all'
      ? `${workspace.fileCount.toLocaleString()}개 파일`
      : `${visibleFileCount.toLocaleString()}/${workspace.fileCount.toLocaleString()}개 표시`
    : ''

  return (
    <aside className="navigation-panel" aria-label="파일 탐색기">
      <div className="navigation-tabs" role="tablist" aria-label="탐색기 보기">
        {([
          ['files', '파일'],
          ['recent', '최근'],
          ['search', '검색'],
        ] as const).map(([tab, label]) => (
          <button
            type="button"
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? 'is-active' : ''}
            onClick={() => onTabChange(tab)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'files' && (
        <section className="navigation-view file-navigation-view">
          <div className="navigation-heading">
            <div className="navigation-heading-copy">
              <strong>{workspace?.name ?? '작업 폴더'}</strong>
              {workspace && (
                <span>
                  {workspaceCountLabel}
                  {workspace.truncated ? ' · 일부만 표시' : ''}
                </span>
              )}
            </div>
            <div className="navigation-heading-actions">
              {workspace && (
                <>
                  <button
                    type="button"
                    aria-label="새 Markdown 파일"
                    title="새 Markdown 파일"
                    data-tooltip="새 Markdown 파일"
                    onClick={onCreateFile}
                  >
                    <SidebarIcon name="file-add" />
                  </button>
                  <button
                    type="button"
                    aria-label="새 폴더"
                    title="새 폴더"
                    data-tooltip="새 폴더"
                    onClick={onCreateFolder}
                  >
                    <SidebarIcon name="folder-add" />
                  </button>
                  <button
                    type="button"
                    aria-label="현재 파일 이름 변경"
                    title="현재 파일 이름 변경"
                    data-tooltip="이름 변경"
                    onClick={onRenameCurrent}
                    disabled={!currentFilePath}
                  >
                    <SidebarIcon name="rename" />
                  </button>
                  <button
                    type="button"
                    aria-label="현재 파일을 휴지통으로 이동"
                    title="현재 파일을 휴지통으로 이동"
                    data-tooltip="휴지통으로 이동"
                    onClick={onDeleteCurrent}
                    disabled={!currentFilePath}
                  >
                    <SidebarIcon name="trash" />
                  </button>
                  <button
                    type="button"
                    aria-label="새로 고침"
                    title="새로 고침"
                    data-tooltip="새로 고침"
                    onClick={onRefreshWorkspace}
                  >
                    <SidebarIcon name="refresh" />
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label="폴더 열기"
                title="폴더 열기"
                data-tooltip="폴더 열기"
                onClick={onOpenWorkspace}
              >
                <SidebarIcon name="folder-open" />
              </button>
              {workspace && (
                <button
                  type="button"
                  aria-label="작업 폴더 닫기"
                  title="작업 폴더 닫기"
                  data-tooltip="작업 폴더 닫기"
                  onClick={onCloseWorkspace}
                >
                  <SidebarIcon name="close" />
                </button>
              )}
            </div>
          </div>

          {workspace && (
            <div className="file-filter-bar" role="group" aria-label="파일 유형 필터">
              {FILE_FILTERS.map((filter) => (
                <button
                  type="button"
                  key={filter.value}
                  className={fileFilter === filter.value ? 'is-active' : ''}
                  title={filter.title}
                  aria-pressed={fileFilter === filter.value}
                  onClick={() => setFileFilter(filter.value)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          )}

          <div className="navigation-scroll file-tree" aria-busy={workspaceLoading}>
            {workspaceLoading ? (
              <p className="navigation-empty">폴더를 읽는 중입니다…</p>
            ) : !workspace ? (
              <div className="navigation-empty navigation-empty-action">
                <p>폴더를 열면 지원되는 텍스트 파일을 트리에서 바로 탐색할 수 있습니다.</p>
                <button type="button" onClick={onOpenWorkspace}>폴더 열기</button>
              </div>
            ) : visibleEntries.length === 0 ? (
              <p className="navigation-empty">
                {fileFilter === 'all'
                  ? '지원되는 텍스트 파일이 없습니다.'
                  : `${selectedFilter.label} 필터와 일치하는 파일이 없습니다.`}
              </p>
            ) : (
              visibleEntries.map((entry) => (
                <FileTreeNode
                  key={entry.path}
                  node={entry}
                  depth={0}
                  showDocumentTitle={showDocumentTitles}
                  currentFilePath={currentFilePath}
                  expandedFolders={expandedFolders}
                  onToggleFolder={onToggleFolder}
                  onOpenFile={onOpenFile}
                  onShowPathMenu={showPathMenu}
                />
              ))
            )}
          </div>
          {workspace && (
            <div className="navigation-footer">
              <button
                type="button"
                className={`navigation-footer-button ${showDocumentTitles ? 'is-active' : ''}`}
                aria-label={showDocumentTitles ? '파일명으로 표시' : '문서 제목으로 표시'}
                title={showDocumentTitles ? '파일명으로 표시' : '문서 제목으로 표시'}
                data-tooltip={showDocumentTitles ? '파일명 표시' : '제목 표시'}
                onClick={() => setShowDocumentTitles((value) => !value)}
              >
                <SidebarIcon name="title" />
              </button>
            </div>
          )}
        </section>
      )}

      {activeTab === 'recent' && (
        <section className="navigation-view recent-navigation-view">
          <div className="navigation-heading">
            <div className="navigation-heading-copy">
              <strong>최근 파일</strong>
              <span>최대 20개</span>
            </div>
            {recentDocuments.length > 0 && (
              <button
                type="button"
                className="text-action"
                onClick={onClearRecentDocuments}
              >
                모두 지우기
              </button>
            )}
          </div>

          <div className="navigation-scroll recent-list">
            {recentDocuments.length === 0 ? (
              <p className="navigation-empty">연 파일이 여기에 표시됩니다.</p>
            ) : (
              recentDocuments.map((document) => (
                <div
                  key={document.path}
                  className={`recent-row ${currentFilePath === document.path ? 'is-current' : ''}`}
                  draggable
                  onDragStart={(event) =>
                    startPathDrag(event, document.path, document.name, false)
                  }
                  onContextMenu={(event) =>
                    showPathMenu(event, document.path, document.name, false)
                  }
                >
                  <button
                    type="button"
                    className="recent-open"
                    title={document.path}
                    onClick={() => onOpenFile(document.path)}
                  >
                    <strong>{document.name}</strong>
                    <span>{compactPath(document.path)}</span>
                  </button>
                  <time dateTime={new Date(document.openedAt).toISOString()}>
                    {formatOpenedAt(document.openedAt)}
                  </time>
                  <button
                    type="button"
                    className="recent-remove"
                    title="최근 목록에서 제거"
                    aria-label={`${document.name} 최근 목록에서 제거`}
                    onClick={() => onRemoveRecentDocument(document.path)}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {activeTab === 'search' && (
        <section className="navigation-view search-navigation-view">
          <div className="search-box-wrap">
            <input
              className="workspace-search-input"
              type="search"
              value={searchQuery}
              placeholder={workspace ? '폴더 전체 검색' : '먼저 작업 폴더를 여세요'}
              disabled={!workspace}
              spellCheck={false}
              aria-label="작업 폴더 전체 검색"
              onChange={(event) => onSearchQueryChange(event.target.value)}
            />
            {searching && <span className="search-spinner" aria-label="검색 중">⋯</span>}
          </div>

          <div className="search-summary">
            {!workspace
              ? '검색할 작업 폴더가 없습니다.'
              : searchQuery.trim().length < 2
                ? '두 글자 이상 입력하세요.'
                : searching
                  ? '검색 중…'
                  : `${searchResults.length.toLocaleString()}개 결과`}
          </div>

          <div className="navigation-scroll search-results">
            {workspace && searchQuery.trim().length >= 2 && !searching && searchResults.length === 0 ? (
              <p className="navigation-empty">일치하는 파일을 찾지 못했습니다.</p>
            ) : (
              searchResults.map((result, index) => (
                <button
                  type="button"
                  className="search-result-row"
                  key={`${result.path}-${result.line}-${index}`}
                  title={result.path}
                  onClick={() => onOpenSearchResult(result)}
                >
                  <span className="search-result-location">
                    <strong>{result.name}</strong>
                    {result.line > 0 && <em>{result.line}줄</em>}
                  </span>
                  <span className="search-result-path">{result.relativePath}</span>
                  <span className="search-result-snippet">
                    <HighlightedText text={result.snippet} query={searchQuery} />
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
      )}

      {pathMenu && (
        <div
          className="path-context-menu"
          style={{ left: pathMenu.x, top: pathMenu.y }}
          role="menu"
          aria-label={`${pathMenu.name} 파일 메뉴`}
          onClick={(event) => event.stopPropagation()}
        >
          {!pathMenu.isDirectory && (
            <button type="button" role="menuitem" autoFocus onClick={openMenuFileInNewTab}>
              새 탭에서 열기
            </button>
          )}
          {!pathMenu.isDirectory && (
            <button type="button" role="menuitem" onClick={openMenuFileInRightPane}>
              오른쪽 패널에서 열기
            </button>
          )}
          {!pathMenu.isDirectory && (
            <button type="button" role="menuitem" onClick={openMenuFileInNewWindow}>
              새 창에서 열기
            </button>
          )}
          {!pathMenu.isDirectory && (
            <button type="button" role="menuitem" onClick={copyMenuFileContents}>
              파일 내용 전체 복사
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            autoFocus={pathMenu.isDirectory}
            onClick={revealMenuPath}
          >
            Finder에서 보기
          </button>
        </div>
      )}
    </aside>
  )
}
