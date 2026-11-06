import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import ini from 'highlight.js/lib/languages/ini'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin } from '@milkdown/kit/prose/state'
import {
  Decoration,
  DecorationSet,
} from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export type HighlightRange = {
  from: number
  to: number
  className: string
}

const maxCacheEntries = 80
const maxCachedSourceLength = 30_000
const highlightCache = new Map<string, HighlightRange[]>()
const autoDetectLanguages = [
  'bash',
  'css',
  'diff',
  'ini',
  'javascript',
  'json',
  'markdown',
  'python',
  'sql',
  'typescript',
  'xml',
  'yaml',
]

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('python', python)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('yaml', yaml)
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' })
hljs.registerAliases(['js', 'mjs', 'cjs'], { languageName: 'javascript' })
hljs.registerAliases(['ts'], { languageName: 'typescript' })
hljs.registerAliases(['jsx', 'tsx', 'html', 'vue', 'svelte'], { languageName: 'xml' })
hljs.registerAliases(['md', 'mkd'], { languageName: 'markdown' })
hljs.registerAliases(['yml'], { languageName: 'yaml' })

function normalizeLanguage(language: string) {
  const value = language.trim().toLowerCase()
  if (!value || value === 'text' || value === 'plain' || value === 'plaintext') {
    return ''
  }
  return hljs.getLanguage(value) ? value : ''
}

function rangesFromHighlightedHtml(html: string, source: string): HighlightRange[] {
  const template = document.createElement('template')
  template.innerHTML = html
  if (template.content.textContent !== source) return []

  const ranges: HighlightRange[] = []
  let offset = 0

  const visit = (node: Node, inheritedClasses: string[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0
      if (length > 0 && inheritedClasses.length > 0) {
        ranges.push({
          from: offset,
          to: offset + length,
          className: Array.from(new Set(inheritedClasses)).join(' '),
        })
      }
      offset += length
      return
    }

    if (!(node instanceof HTMLElement) && !(node instanceof DocumentFragment)) return

    const ownClasses =
      node instanceof HTMLElement
        ? Array.from(node.classList).filter((className) => className.startsWith('hljs-'))
        : []
    const nextClasses = ownClasses.length > 0 ? [...inheritedClasses, ...ownClasses] : inheritedClasses
    node.childNodes.forEach((child) => visit(child, nextClasses))
  }

  visit(template.content, [])
  return ranges
}

function highlightRanges(source: string, language: string): HighlightRange[] {
  if (!source) return []

  const normalizedLanguage = normalizeLanguage(language)
  const cacheKey = `${normalizedLanguage || 'auto'}\u0000${source}`
  const canCache = source.length <= maxCachedSourceLength
  const cached = canCache ? highlightCache.get(cacheKey) : undefined
  if (cached) return cached

  let highlightedHtml = ''
  try {
    highlightedHtml = normalizedLanguage
      ? hljs.highlight(source, { language: normalizedLanguage, ignoreIllegals: true }).value
      : hljs.highlightAuto(source, autoDetectLanguages).value
  } catch {
    highlightedHtml = ''
  }

  const ranges = highlightedHtml ? rangesFromHighlightedHtml(highlightedHtml, source) : []
  if (canCache) {
    highlightCache.set(cacheKey, ranges)
    if (highlightCache.size > maxCacheEntries) {
      const [oldestKey] = highlightCache.keys()
      if (oldestKey) highlightCache.delete(oldestKey)
    }
  }
  return ranges
}

export function highlightCodeRanges(source: string, language: string): HighlightRange[] {
  return highlightRanges(source, language)
}

export const codeSyntaxHighlighting = $prose(() => {
  let cachedDoc: ProseNode | null = null
  let cachedDecorations = DecorationSet.empty

  return new Plugin({
    props: {
      decorations: (state) => {
        if (cachedDoc === state.doc) return cachedDecorations

        const decorations: Decoration[] = []

        state.doc.descendants((node, pos) => {
          if (!node.type.spec.code) return true

          const language = String(node.attrs.language ?? '').trim().toLowerCase()
          if (language === 'mermaid') return false

          const source = node.textContent
          const start = pos + 1
          for (const range of highlightRanges(source, language)) {
            decorations.push(
              Decoration.inline(start + range.from, start + range.to, {
                class: range.className,
              })
            )
          }
          return false
        })

        cachedDoc = state.doc
        cachedDecorations = decorations.length > 0
          ? DecorationSet.create(state.doc, decorations)
          : DecorationSet.empty

        return cachedDecorations
      },
    },
  })
})
