import { handleMessage } from './message-router'

chrome.runtime.onInstalled.addListener(() => {
  console.log('[StyleLens] background installed')
})

// 调试/测试钩子：记录最近一次 StyleProfile（e2e golden 捕获用）
;(globalThis as Record<string, unknown>).__stylelensLastProfile = null

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: string }).type === 'STYLE_PROFILE_READY'
  ) {
    ;(globalThis as Record<string, unknown>).__stylelensLastProfile = (
      message as { payload: unknown }
    ).payload
  }
  sendResponse(handleMessage(message))
  return false
})
