import type { SelectedElement } from '../../shared/schemas/messages'
import { dispatchUi } from '../state/ui-controller'
import { useAnalysisStore } from '../state/stores'
import { targetElement } from '../state/target-registry'
import { cancelActivePrompt } from '../selector/lock'
import { buildProfile, type BuildOptions } from './profile-builder'

/**
 * 分析运行器：ANALYSIS_START → 采集构建 StyleProfile → STYLE_PROFILE_READY。
 * （§68 Sprint 3 交付物：对 fixtures 生成完整 StyleProfile）
 */
export async function runAnalysis(target: SelectedElement): Promise<void> {
  const analysis = useAnalysisStore.getState()
  analysis.setStatus('analyzing')
  analysis.setProgress(5)
  analysis.resetPrompt()
  analysis.resetReasoning()
  analysis.setProfile(undefined)
  analysis.setError(undefined)
  // 新分析覆盖旧流（若上一轮 Prompt 仍在流式）
  cancelActivePrompt()

  const el = targetElement(target.uid)
  if (!el || !el.isConnected) {
    dispatchUi({ type: 'FAIL' })
    analysis.setStatus('error')
    analysis.setProgress(0)
    return
  }

  const onPhase: BuildOptions['onPhase'] = (phase, progress) => {
    analysis.setStatus('analyzing')
    analysis.setProgress(progress)
  }

  try {
    const profile = buildProfile(el, { scope: target.scope, onPhase })
    analysis.setProfile(profile)
    analysis.setProgress(100)

    // 上报 background 编排 AI 请求（Sprint 4：SSE 流式 → PROMPT_CHUNK 回流）
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'STYLE_PROFILE_READY',
        payload: profile,
      })
      console.info('[StyleLens][Bridge] profile:sent-to-background', {
        target: profile.target.tagName,
        factCount: profile.facts.length,
        response,
      })
    } catch (error) {
      console.error('[StyleLens][Bridge] profile:send-failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      dispatchUi({ type: 'FAIL' })
      analysis.setStatus('error')
      return
    }
  } catch (err) {
    console.error('[StyleLens] analysis failed', err)
    dispatchUi({ type: 'FAIL' })
    analysis.setStatus('error')
    analysis.setProgress(0)
  }
}
