import { describe, expect, it } from 'vitest'
import { compilePromptContext } from './prompt-compiler'
import type { LightProfile } from './types'

const profile: LightProfile = {
  version: '0.1.0',
  target: { uid: 't-1', tagName: 'button', classes: ['btn'] },
  context: {
    componentBoundary: { kind: 'card', confidence: 0.9, evidence: ['visual-enclosure'] },
    outerLayoutContext: ['section'],
    ancestors: [{ tagName: 'div', classes: ['card-footer'] }],
  },
  layout: { display: 'inline-flex', position: 'static', semanticDescription: 'horizontal flex' },
  spacing: {
    padding: { top: '0px', right: '16px', bottom: '0px', left: '16px' },
    margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
    gap: '8px',
    boxSizing: 'border-box',
    renderedSize: { width: 128, height: 40 },
  },
  typography: {
    fontFamily: 'Inter',
    fontFamilySource: 'inherited',
    fontSize: '14px',
    fontWeight: '600',
    lineHeight: '40px',
    textAlign: 'center',
    semanticRole: 'action-label',
  },
  visual: {
    color: { observed: 'rgb(255,255,255)', normalized: '#ffffff' },
    background: {
      kind: 'color',
      color: { observed: 'rgb(99,102,241)', normalized: '#6366f1', token: '--color-primary' },
      semanticDescription: 'Solid surface',
    },
    radius: { summary: '8px' },
    shadows: [],
  },
  assets: [],
  responsive: {
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    matchedMediaQueries: [],
    rootFontSize: '16px',
    themeSummary: 'light theme',
  },
  states: [{ state: 'default', captured: true }],
  facts: [
    { property: 'display', value: 'inline-flex', source: 'computed' },
    { property: 'background-color', value: '#6366f1', source: 'computed' },
    { property: 'zoom', value: '1', source: 'computed' }, // 噪声：不应进入
  ],
  inferences: [
    { type: 'component-type', conclusion: 'part of a card', confidence: 0.9, reason: ['visual-enclosure'] },
  ],
  warnings: [],
}

describe('compilePromptContext（§24 / §63.1）', () => {
  it('renders markdown with all §25 sections', () => {
    const { markdown } = compilePromptContext(profile)
    expect(markdown).toContain('# Recreate This UI Component')
    for (const title of [
      '## Goal',
      '## Component Context',
      '## Structure',
      '## Layout',
      '## Spacing',
      '## Typography',
      '## Colors & Surfaces',
      '## Borders & Shadows',
      '## Responsive Context',
      '## Interaction States',
      '## Implementation Requirements',
      '## Fidelity Requirements',
    ]) {
      expect(markdown).toContain(title)
    }
  })

  it('filters noise facts and keeps facts/inferences separate', () => {
    const { data } = compilePromptContext(profile)
    const observed = data.observedFacts as string[]
    expect(observed.some((f) => f.startsWith('zoom'))).toBe(false)
    expect(observed.some((f) => f.startsWith('display'))).toBe(true)
    expect(data.inferences).toHaveLength(1)
  })

  it('switches Implementation Requirements by targetFramework', () => {
    const agnostic = compilePromptContext(profile, { targetFramework: 'agnostic' }).markdown
    const tailwind = compilePromptContext(profile, { targetFramework: 'tailwind' }).markdown
    expect(agnostic).toContain('do not assume a specific one')
    expect(tailwind).toContain('Tailwind CSS utility classes')
    expect(tailwind).not.toContain('do not assume a specific one')
  })
})
