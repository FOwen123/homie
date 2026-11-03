import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Shows what broke instead of a blank page, with a way back.
class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-md p-6 text-[15px]">
        <p>Something went wrong. 出了點問題。</p>
        <pre className="mt-2 whitespace-pre-wrap text-[12px] text-fog">{String(this.state.error.stack ?? this.state.error)}</pre>
        <button className="mt-4 min-h-11 rounded-full bg-charcoal px-4 text-paper-white" onClick={() => location.reload()}>Reload</button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary><App /></Boundary>
  </StrictMode>,
)
