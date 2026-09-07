import { cancelPrompt, requestPrompt } from './ai-client'
import { handleMessage } from './message-router'
import type { StyleProfile } from '../shared/schemas/style-profile'

chrome.runtime.onInstalled.addListener(() => {
  console.log('[StyleLens] background installed')
})

// 调试/测试钩子：记录最近一次 StyleProfile / Prompt（e2e golden 捕获用）
;(globalThis as Record<string, unknown>).__stylelensLastProfile = null
;(globalThis as Record<string, unknown>).__stylelensLastPrompt = null

/**
 * 向标签页发送 SELECTION_START；若页面未注入 content script
 * （如扩展安装前已打开的页面），用 scripting 动态注入后重试。
 */
async function ensureInjectedAndSend(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SELECTION_START' })
    return true
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
      await chrome.tabs.sendMessage(tabId, { type: 'SELECTION_START' })
      return true
    } catch {
      return false
    }
  }
}

// 快捷键（Alt+Shift+S，manifest commands 可配置）→ 进入选择模式
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-select') return
  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (!tab?.id) return
    const ok = await ensureInjectedAndSend(tab.id)
    if (!ok) {
      console.warn('[StyleLens] cannot start selection on this page (chrome:// or blocked by site)')
    }
  })()
})

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const msg = message as { type?: string }

  if (msg.type === 'PROMPT_CANCEL') {
    // 中止当前 tab 的流式请求（Re-select / Esc / 新分析覆盖旧流）
    const tabId = sender.tab?.id
    if (tabId != null) cancelPrompt(tabId)
  }

  if (msg.type === 'SELECTION_START') {
    // Popup → Background：复用动态注入逻辑，兼容扩展安装前已打开的页面。
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      if (!tab?.id) return
      const ok = await ensureInjectedAndSend(tab.id)
      if (!ok) {
        console.warn(
          '[StyleLens] cannot start selection on this page (chrome:// or blocked by site)',
        )
      }
    })()
  }

  if (msg.type === 'STYLE_PROFILE_READY') {
    const payload = (message as { payload: StyleProfile }).payload
    ;(globalThis as Record<string, unknown>).__stylelensLastProfile = payload
    // 编排 AI 请求：Content → Background → services/api → 流回 Content
    const tabId = sender.tab?.id
    if (tabId != null) {
      console.info('[StyleLens][Bridge] profile:received-in-background', {
        tabId,
        target: payload.target.tagName,
        factCount: payload.facts.length,
      })
      void requestPrompt(payload, tabId, sender.tab?.windowId)
    }
  }
  sendResponse(handleMessage(message))
  return false
})
