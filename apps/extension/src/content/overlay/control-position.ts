import type { SelectedElement } from '../../shared/schemas/messages'

/** 控制条定位：目标正下方，viewport clamp。PromptPanel 据此锚定，保证「跟手」 */
export function controlPosition(target: SelectedElement): { left: number; top: number } {
  return {
    left: Math.max(4, Math.min(target.rect.left, window.innerWidth - 340)),
    top: Math.min(target.rect.bottom + 8, window.innerHeight - 48),
  }
}
