import { $nodeSchema, $remark } from '@milkdown/kit/utils'
import remarkFrontmatter from 'remark-frontmatter'
import type { Options as RemarkFrontmatterOptions } from 'remark-frontmatter'

const remarkFrontmatterPlugin = $remark<'remarkFrontmatter', RemarkFrontmatterOptions>(
  'remarkFrontmatter',
  () => remarkFrontmatter,
  ['yaml']
)

export const frontmatterSchema = $nodeSchema('frontmatter', () => ({
  content: 'text*',
  group: 'block',
  marks: '',
  defining: true,
  code: true,
  parseDOM: [
    {
      tag: 'pre[data-type="frontmatter"]',
      preserveWhitespace: 'full' as const,
    },
  ],
  toDOM: () => [
    'pre',
    { 'data-type': 'frontmatter', 'data-label': 'YAML Front Matter' },
    ['code', 0],
  ],
  parseMarkdown: {
    match: (node) => node.type === 'yaml',
    runner: (state, node, type) => {
      state.openNode(type)
      const value = typeof node.value === 'string' ? node.value : ''
      if (value) state.addText(value)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'frontmatter',
    runner: (state, node) => {
      state.addNode('yaml', undefined, node.textContent)
    },
  },
}))

export const frontmatter = [remarkFrontmatterPlugin, frontmatterSchema].flat()
