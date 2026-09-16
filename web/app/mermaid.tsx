'use client'

import { useEffect } from 'react'

/**
 * ```mermaid 코드 블록을 그림으로 바꾼다.
 *
 * 깃허브는 같은 블록을 자체적으로 렌더링한다.
 * 마크다운 하나로 저장소와 이 사이트 양쪽에서 보이게 하려는 것이다.
 *
 * 다이어그램이 없는 페이지에서는 mermaid를 아예 받지 않는다.
 * 번들이 크기 때문에 필요한 페이지에서만 동적으로 가져온다.
 */
export default function Mermaid() {
  useEffect(() => {
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>('pre > code.language-mermaid'),
    )
    if (blocks.length === 0) return

    let cancelled = false

    void (async () => {
      const { default: mermaid } = await import('mermaid')
      if (cancelled) return

      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
      mermaid.initialize({
        startOnLoad: false,
        theme: dark ? 'dark' : 'neutral',
        // strict는 HTML 라벨을 끈다. 그러면 mermaid가 SVG 텍스트로 그리면서
        // 한글 폭을 라틴 문자 기준으로 재고, 라벨이 상자 밖으로 잘린다.
        // 마크다운은 이 저장소가 쓴 것이므로 antiscript로 낮춘다.
        securityLevel: 'antiscript',
        fontFamily: 'inherit',
        // 기본 wrappingWidth(200px)는 한글에서 단어 중간을 끊는다.
        flowchart: { curve: 'basis', htmlLabels: true, useMaxWidth: true, wrappingWidth: 320 },
        sequence: { useMaxWidth: true },
      })

      for (const [i, block] of blocks.entries()) {
        const source = block.textContent ?? ''
        const host = block.parentElement
        if (!host) continue

        try {
          const { svg } = await mermaid.render(`diagram-${i}`, source)
          const figure = document.createElement('figure')
          figure.className = 'diagram'
          figure.innerHTML = svg
          host.replaceWith(figure)
        } catch {
          // 문법이 틀리면 원래 코드 블록을 그대로 둔다.
          // 그림이 안 나오는 것보다 내용이 사라지는 편이 나쁘다.
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
