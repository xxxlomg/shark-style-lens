import { handleMessage } from './message-router'

chrome.runtime.onInstalled.addListener(() => {
  console.log('[StyleLens] background installed')
})

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  sendResponse(handleMessage(message))
  return false
})
