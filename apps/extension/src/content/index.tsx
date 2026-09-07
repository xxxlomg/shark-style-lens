import { createRoot } from 'react-dom/client'
import { extensionMessageSchema } from '../shared/schemas/messages'
import { containsSensitiveText } from './analyzer/privacy'
import { App } from './overlay/App'
import styles from './overlay/styles.css?inline'
import { dispatchUi } from './state/ui-controller'
import { useAnalysisStore, useSelectionStore } from './state/stores'

const HOST_ID = 'stylelens-root'
let promptChunkCount = 0
let overlayVisibilityBeforeCapture: string | undefined
const captureMaskedStyles = new Map<HTMLElement, string | null>()

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

async function setOverlayVisibilityForCapture(hidden: boolean): Promise<boolean> {
  const host = document.getElementById(HOST_ID)
  if (!host) return false

  if (hidden) {
    if (overlayVisibilityBeforeCapture === undefined) {
      overlayVisibilityBeforeCapture = host.style.visibility
    }
    host.style.visibility = 'hidden'
    maskSensitiveControls()
    maskSensitiveText()
  } else if (overlayVisibilityBeforeCapture !== undefined) {
    host.style.visibility = overlayVisibilityBeforeCapture
    overlayVisibilityBeforeCapture = undefined
    restoreSensitiveControls()
  }
  await nextPaint()
  return true
}

function maskSensitiveControls() {
  captureMaskedStyles.clear()
  const controls = document.querySelectorAll<HTMLElement>(
    'input, textarea, select, [contenteditable="true"]',
  )
  controls.forEach((control) => {
    captureMaskedStyles.set(control, control.getAttribute('style'))
    control.style.setProperty('color', 'transparent', 'important')
    control.style.setProperty('-webkit-text-fill-color', 'transparent', 'important')
    control.style.setProperty('caret-color', 'transparent', 'important')
  })
}

function maskSensitiveText() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const owners = new Set<HTMLElement>()
  let node: Node | null
  while ((node = walker.nextNode())) {
    const owner = node.parentElement
    if (owner && containsSensitiveText(node.textContent ?? '')) owners.add(owner)
  }
  owners.forEach((owner) => {
    if (!captureMaskedStyles.has(owner)) captureMaskedStyles.set(owner, owner.getAttribute('style'))
    owner.style.setProperty('color', 'transparent', 'important')
    owner.style.setProperty('-webkit-text-fill-color', 'transparent', 'important')
  })
}

function restoreSensitiveControls() {
  for (const [control, style] of captureMaskedStyles) {
    if (style === null) control.removeAttribute('style')
    else control.setAttribute('style', style)
  }
  captureMaskedStyles.clear()
}

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

// 消息路由：SELECTION_START（Popup/快捷键）+ Prompt 流回执
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const parsed = extensionMessageSchema.safeParse(message)
  if (!parsed.success) return
  const { type } = parsed.data

  if (type === 'VISION_CAPTURE_PREPARE' || type === 'VISION_CAPTURE_RESTORE') {
    void setOverlayVisibilityForCapture(type === 'VISION_CAPTURE_PREPARE')
      .then((ok) => sendResponse({ ok }))
      .catch((error: unknown) => {
        console.error('[StyleLens][Bridge] vision:capture-overlay-failed', error)
        sendResponse({ ok: false })
      })
    return true
  }

  switch (type) {
    case 'SELECTION_START':
      dispatchUi({ type: 'START_SELECT' })
      break
    case 'PROMPT_START':
      promptChunkCount = 0
      console.info('[StyleLens][Bridge] prompt:start')
      useAnalysisStore.getState().resetPrompt()
      useAnalysisStore.getState().resetReasoning()
      dispatchUi({ type: 'PROMPT_START' })
      break
    case 'PROMPT_CHUNK':
      promptChunkCount += 1
      useAnalysisStore.getState().appendPrompt(parsed.data.payload.text)
      break
    case 'PROMPT_REASONING_CHUNK':
      // Be defensive if a browser bridge delivers the first token before the
      // lifecycle marker. The stream view must never be hidden in analyzing UI.
      if (useSelectionStore.getState().uiState === 'analyzing') {
        dispatchUi({ type: 'PROMPT_START' })
      }
      useAnalysisStore.getState().appendReasoning(parsed.data.payload.text)
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
