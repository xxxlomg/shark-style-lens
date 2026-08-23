import { createRoot } from 'react-dom/client'
import { extensionMessageSchema } from '../shared/schemas/messages'
import { App } from './overlay/App'
import styles from './overlay/styles.css?inline'
import { dispatchUi } from './state/ui-controller'

const HOST_ID = 'stylelens-root'

function mount() {
  if (document.getElementById(HOST_ID)) return

  const host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;'

  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = styles
  shadow.appendChild(style)

  const mountPoint = document.createElement('div')
  mountPoint.id = 'stylelens-mount'
  shadow.appendChild(mountPoint)

  document.documentElement.appendChild(host)
  createRoot(mountPoint).render(<App />)
}

// Popup / 快捷键 → 进入选择模式（§3.2）
chrome.runtime.onMessage.addListener((message: unknown) => {
  const parsed = extensionMessageSchema.safeParse(message)
  if (parsed.success && parsed.data.type === 'SELECTION_START') {
    dispatchUi({ type: 'START_SELECT' })
  }
})

mount()
