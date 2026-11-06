import { createRoot } from 'react-dom/client'
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/gapcursor/style/gapcursor.css'
import '@milkdown/kit/prose/tables/style/tables.css'
import 'katex/dist/katex.min.css'
import './style.css'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)
