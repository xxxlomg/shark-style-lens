/** Popup：极简入口（§34 / §57.3）—— MVP 只做「开始选择」 */
export function App() {
  const startSelection = () => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'SELECTION_START' }).catch(() => {
          // 目标页未注入 content script（如 chrome:// 页）时静默失败
        })
      }
    })
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
      <h1 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px' }}>StyleLens</h1>
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
