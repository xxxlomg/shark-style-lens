import { requestPrompt } from './ai-client'
import { handleMessage } from './message-router'
import type { StyleProfile } from '../shared/schemas/style-profile'

chrome.runtime.onInstalled.addListener(() => {
  console.log('[StyleLens] background installed')
})

// 调试/测试钩子：记录最近一次 StyleProfile（e2e golden 捕获用）
;(globalThis as Record<string, unknown>).__stylelensLastProfile = null
// 调试/测试钩子：最近一次生成完成的 Prompt
;(globalThis as Record<string, unknown>).__stylelensLastPrompt = null

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: string }).type === 'STYLE_PROFILE_READY'
  ) {
    const payload = (message as { payload: StyleProfile }).payload
    ;(globalThis as Record<string, unknown>).__stylelensLastProfile = payload
    // 编排 AI 请求（MESSAGE_PROTOCOL §5）：Content → Background → services/api → 流回 Content
    const tabId = sender.tab?.id
    if (tabId != null) {
      void requestPrompt(payload, tabId)
    }
  }
  sendResponse(handleMessage(message))
  return false
})
