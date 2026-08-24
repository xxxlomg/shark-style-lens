import { BrandMark } from '../shared/BrandMark'

/** Popup：极简入口（§34 / §57.3）—— MVP 只做「开始选择」 */
export function App() {
  const startSelection = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'SELECTION_START' })
    } finally {
      // Popup 不应遮挡正在被选择的页面。
      window.close()
    }
  }

  return (
    <div
      style={{
        width: 260,
        padding: 16,
        fontFamily: 'system-ui, sans-serif',
        color: '#0f172a',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
        <BrandMark size={28} />
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>StyleLens</h1>
      </div>
      <p style={{ fontSize: 13, color: '#475569', margin: '0 0 12px', lineHeight: 1.5 }}>
        Select any UI element on the page to generate a reconstruction prompt for AI coding tools.
      </p>
      <button
        type="button"
        onClick={startSelection}
        style={{
          width: '100%',
          padding: '9px 12px',
          background: '#6366f1',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Select Element
      </button>
      <p style={{ fontSize: 12, color: '#94a3b8', margin: '10px 0 0' }}>
        Shortcut: Alt+Shift+S · Target: Framework-agnostic
      </p>
    </div>
  )
}
