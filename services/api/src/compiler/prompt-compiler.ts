import type { CompiledContext, ProviderOptions } from '../providers/types'
import type { LightProfile } from './types'

/** §49.3 高价值属性（去噪：浏览器默认属性不进入 Prompt） */
const HIGH_VALUE_PROPS = new Set([
  'display',
  'position',
  'width',
  'height',
  'min-height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'gap',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'align-self',
  'grid-template-columns',
  'grid-template-rows',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'color',
  'background-color',
  'background-image',
  'border-radius',
  'box-shadow',
  'opacity',
  'transform',
  'z-index',
])

const FRAMEWORK_NOTES: Record<NonNullable<ProviderOptions['targetFramework']>, string> = {
  agnostic: 'Implement with plain HTML/CSS or any framework; do not assume a specific one.',
  react: 'Implement as a React component with inline styles or CSS modules; do not use a specific UI library.',
  vue: 'Implement as a Vue single-file component with scoped styles.',
  'html-css': 'Implement as plain HTML + CSS.',
  tailwind: 'Implement using Tailwind CSS utility classes; do not use custom component libraries.',
  nextjs: 'Implement as a Next.js (App Router) React component.',
}

export interface PromptSection {
  title: string
  lines: string[]
}

/** StyleProfile → 结构化 Prompt 上下文（§24 / §63.1：去噪、排序、Facts/Inferences 分区） */
export function compilePromptContext(profile: LightProfile, options: ProviderOptions = {}): CompiledContext {
  const framework = options.targetFramework ?? 'agnostic'
  const sections: PromptSection[] = []

  // 1. Goal（§26）
  sections.push({
    title: 'Goal',
    lines: [
      'Recreate the selected UI as closely as possible to the observed result.',
      'Prioritize visual fidelity over source-code similarity.',
      'Do not attempt to reproduce the original frontend framework or component library.',
    ],
  })

  // 2. Component Context（§6）
  const boundary = profile.context?.componentBoundary
  sections.push({
    title: 'Component Context',
    lines: boundary
      ? [
          `This element appears to be part of a "${boundary.kind}" component (confidence ${Math.round(boundary.confidence * 100)}%).`,
          `Evidence: ${boundary.evidence.join(', ')}.`,
        ]
      : ['The element stands alone (no clear enclosing component was detected).'],
  })
  if (profile.context?.outerLayoutContext?.length) {
    sections[sections.length - 1].lines.push(
      `Outer layout context: ${profile.context.outerLayoutContext.join(' → ')}.`,
    )
  }

  // 3. Structure（§7 摘要）
  const ancestors = profile.context?.ancestors ?? []
  sections.push({
    title: 'Structure',
    lines:
      ancestors.length > 0
        ? [
            `Target: <${profile.target.tagName}>${profile.target.classes?.length ? ` .${profile.target.classes.join('.')}` : ''}`,
            ...ancestors.slice(0, 3).map((a) => `Ancestor: <${a.tagName}>${a.classes.length ? ` .${a.classes.join('.')}` : ''}`),
          ]
        : [`Target: <${profile.target.tagName}>`],
  })

  // 4. Layout（§11）
  const layout = profile.layout ?? {}
  sections.push({
    title: 'Layout',
    lines: [
      layout.semanticDescription ?? `display: ${layout.display ?? 'n/a'}; position: ${layout.position ?? 'n/a'}.`,
      `Box model: ${JSON.stringify(profile.spacing ?? {})}`,
    ],
  })

  // 5. Spacing（§12）
  const spacing = profile.spacing
  if (spacing) {
    sections.push({
      title: 'Spacing',
      lines: [
        `Padding: ${formatEdges(spacing.padding)}; Margin: ${formatEdges(spacing.margin)}`,
        spacing.gap ? `Child gap: ${spacing.gap}.` : '',
        `Rendered size: ${spacing.renderedSize?.width} × ${spacing.renderedSize?.height}px (box-sizing: ${spacing.boxSizing}).`,
      ].filter(Boolean),
    })
  }

  // 6. Typography（§13）
  const typo = profile.typography ?? {}
  sections.push({
    title: 'Typography',
    lines: [
      `Font: ${typo.fontFamily ?? 'inherited'} (${typo.fontFamilySource ?? 'computed'})`,
      `Size: ${typo.fontSize ?? 'n/a'}; Weight: ${typo.fontWeight ?? 'n/a'}; Line-height: ${typo.lineHeight ?? 'n/a'}${typo.letterSpacing ? `; Letter-spacing: ${typo.letterSpacing}` : ''}`,
      `Align: ${typo.textAlign ?? 'n/a'}${typo.semanticRole ? `; Semantic role: "${typo.semanticRole}"` : ''}`,
    ].filter(Boolean),
  })

  // 7. Colors & Surfaces（§14）
  const visual = profile.visual ?? {}
  const bg = visual.background
  sections.push({
    title: 'Colors & Surfaces',
    lines: [
      bg?.kind === 'color' && bg.color
        ? `Background: ${bg.color.observed} (#${bg.color.normalized.replace('#', '')})${bg.color.token ? ` via token ${bg.color.token}` : ''}`
        : bg?.kind === 'gradient'
          ? `Background: gradient ${bg.gradient}`
          : 'Background: none/transparent',
      visual.color ? `Foreground: ${visual.color.observed}${visual.color.token ? ` via token ${visual.color.token}` : ''}` : '',
    ].filter(Boolean),
  })

  // 8. Borders & Shadows（§15）
  const border = visual.border
  const radius = visual.radius
  const shadows = visual.shadows ?? []
  sections.push({
    title: 'Borders & Shadows',
    lines: [
      border ? `Border: ${border.width} ${border.style}` : 'Border: none',
      radius ? `Corner radius: ${radius.summary ?? radius.topLeft}` : 'Corner radius: none',
      ...shadows.map((s) => `Shadow: ${s.semanticDescription ?? `${s.offsetX} ${s.offsetY} ${s.blur} ${s.spread}`}`),
    ].filter(Boolean),
  })

  // 9. Assets（§18）
  const assets = profile.assets ?? []
  if (assets.length > 0) {
    sections.push({
      title: 'Assets',
      lines: assets.map((a) => a.description ?? `${a.kind} asset`),
    })
  }

  // 10. Responsive Context（§22）
  const responsive = profile.responsive
  if (responsive) {
    sections.push({
      title: 'Responsive Context',
      lines: [
        `Viewport: ${responsive.viewport?.width} × ${responsive.viewport?.height}, dpr ${'1'}`,
        `Color scheme: ${responsive.colorScheme}; Root font-size: ${responsive.rootFontSize}`,
        responsive.themeSummary ? `Theme: ${responsive.themeSummary}.` : '',
      ].filter(Boolean),
    })
  }

  // 11. Interaction States（§17）
  const states = profile.states ?? []
  sections.push({
    title: 'Interaction States',
    lines:
      states.length > 0
        ? states.map((s) => `${s.state}${s.captured ? ' (captured)' : ' (not captured)'}`)
        : ['Only the default state was observed.'],
  })

  // 12. Implementation Requirements（§27 / §25）
  sections.push({
    title: 'Implementation Requirements',
    lines: [
      FRAMEWORK_NOTES[framework],
      'Use semantic HTML and accessible keyboard/focus behavior.',
      'Hover and focus states should receive visible feedback.',
    ],
  })

  // 13. Fidelity Requirements（§26）
  sections.push({
    title: 'Fidelity Requirements',
    lines: [
      'Reproduce visual hierarchy, spacing, proportions, typography, color, surface treatment, layout behavior, responsive intent and component relationships.',
      'Approximate fractional pixels to whole numbers where appropriate; preserve relative proportions.',
    ],
  })

  // Observed Facts / Inferences 分区（§60.1：推断不得伪装成事实）
  const facts = (profile.facts ?? [])
    .filter((f) => HIGH_VALUE_PROPS.has(f.property))
    .slice(0, 30)
    .map((f) => `${f.property}: ${f.value}`)

  return {
    markdown: renderMarkdown(sections),
    data: {
      sections,
      observedFacts: facts,
      inferences: profile.inferences.map((i) => ({
        type: i.type,
        conclusion: i.conclusion,
        confidence: i.confidence,
        reason: i.reason,
      })),
      warnings: profile.warnings ?? [],
    },
  }
}

function formatEdges(edges?: Record<string, string>): string {
  if (!edges) return 'n/a'
  return `${edges.top ?? '0'} ${edges.right ?? '0'} ${edges.bottom ?? '0'} ${edges.left ?? '0'}`
}

/** §25 Prompt 输出结构（markdown） */
function renderMarkdown(sections: PromptSection[]): string {
  return [
    '# Recreate This UI Component',
    '',
    ...sections.flatMap((s) => [`## ${s.title}`, '', ...s.lines, '']),
  ].join('\n')
}
