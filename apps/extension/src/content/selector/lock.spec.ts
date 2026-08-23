import { describe, expect, it } from 'vitest'
import { buildSelector } from './lock'

function fakeEl(opts: {
  tag: string
  id?: string
  classes?: string[]
  parent?: HTMLElement
}): HTMLElement {
  return {
    tagName: opts.tag,
    id: opts.id,
    classList: opts.classes ?? [],
    parentElement: opts.parent ?? null,
  } as unknown as HTMLElement
}

describe('buildSelector', () => {
  it('builds tag#id.class chain with depth limit', () => {
    const btn = fakeEl({
      tag: 'BUTTON',
      id: 'cta',
      classes: ['btn', 'btn-primary'],
      parent: fakeEl({
        tag: 'DIV',
        classes: ['card-footer'],
        parent: fakeEl({ tag: 'DIV', classes: ['card'] }),
      }),
    })
    const sel = buildSelector(btn)
    expect(sel).toBe('div.card > div.card-footer > button#cta.btn.btn-primary')
  })

  it('limits depth and skips missing classes', () => {
    const leaf = fakeEl({
      tag: 'SPAN',
      parent: fakeEl({
        tag: 'A',
        classes: ['link'],
        parent: fakeEl({ tag: 'NAV', parent: fakeEl({ tag: 'HEADER' }) }),
      }),
    })
    expect(buildSelector(leaf, 2)).toBe('a.link > span')
  })
})
