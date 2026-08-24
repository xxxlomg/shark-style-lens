import { createRoot } from 'react-dom/client'
import { extensionMessageSchema } from '../shared/schemas/messages'
import { App } from './overlay/App'
import styles from './overlay/styles.css?inline'
import { dispatchUi } from './state/ui-controller'
import { useAnalysisStore } from './state/stores'

const HOST_ID = 'stylelens-root'
let promptChunkCount = 0

function mount() {
  if (document.getElementById(HOST_ID)) return

  try {
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
  } catch (err) {
    console.error('[StyleLens] content mount failed', err)
  }
}

// 消息路由（§3.1）：SELECTION_START（Popup/快捷键）+ Prompt 流回执
chrome.runtime.onMessage.addListener((message: unknown) => {
  const parsed = extensionMessageSchema.safeParse(message)
  if (!parsed.success) return
  const { type } = parsed.data

  switch (type) {
    case 'SELECTION_START':
      dispatchUi({ type: 'START_SELECT' })
      break
    case 'PROMPT_START':
      promptChunkCount = 0
      console.info('[StyleLens][Bridge] prompt:start')
      useAnalysisStore.getState().setStatus('streaming')
      break
    case 'PROMPT_CHUNK':
      promptChunkCount += 1
      useAnalysisStore.getState().appendPrompt(parsed.data.payload.text)
      break
    case 'PROMPT_COMPLETE':
      console.info('[StyleLens][Bridge] prompt:complete', { chunkCount: promptChunkCount })
      dispatchUi({ type: 'PROMPT_COMPLETE' })
      break
    case 'ANALYSIS_ERROR':
      console.error('[StyleLens][Bridge] prompt:error', parsed.data.payload)
      useAnalysisStore.getState().setError(parsed.data.payload.message)
      dispatchUi({ type: 'FAIL' })
      break
  }
})

mount()
