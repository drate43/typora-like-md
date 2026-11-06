export type WorkspaceNode = {
  name: string
  title?: string | null
  path: string
  relativePath: string
  isDirectory: boolean
  children: WorkspaceNode[]
}

export type WorkspaceSnapshot = {
  root: string
  name: string
  entries: WorkspaceNode[]
  fileCount: number
  truncated: boolean
}

export type SearchMatch = {
  path: string
  relativePath: string
  name: string
  line: number
  snippet: string
  matchKind: 'name' | 'content'
}

export type RecentDocument = {
  path: string
  name: string
  openedAt: number
}

export type SidebarTab = 'files' | 'recent' | 'search'
