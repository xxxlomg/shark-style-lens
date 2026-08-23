import type { SelectedElement } from '../../shared/schemas/messages'
import { dispatchUi } from '../state/ui-controller'
import { useAnalysisStore } from '../state/stores'
import { targetElement } from '../state/target-registry'
import { buildProfile, type BuildOptions } from './profile-builder'

/**
 * 分析运行器：ANALYSIS_START → 采集构建 StyleProfile → STYLE_PROFILE_READY → PROFILE_READY。
 * （§68 Sprint 3 交付物：对 fixtures 生成完整 StyleProfile）
 */
export async function runAnalysis(target: SelectedElement): Promise<void> {
  const analysis = useAnalysisStore.getState()
  analysis.setStatus('analyzing')
  analysis.setProgress(5)

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

    // 上报 background（Sprint 4 用于 AI 请求编排）；UI 本地已完成
    chrome.runtime.sendMessage({ type: 'STYLE_PROFILE_READY', payload: profile }).catch(() => {})
    // Sprint 3：无真实 Prompt，分析完成后直接进入 completed 态（Sprint 4 改为流式结束触发）
    dispatchUi({ type: 'PROFILE_READY' })
    dispatchUi({ type: 'PROMPT_COMPLETE' })
  } catch (err) {
    console.error('[StyleLens] analysis failed', err)
    dispatchUi({ type: 'FAIL' })
    analysis.setStatus('error')
    analysis.setProgress(0)
  }
}
