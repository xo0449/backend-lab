const EMAIL = 'dreamjh1111@gmail.com'

/** 이 저장소에는 Contact 페이지가 없다. 블로그 쪽 것을 가리킨다. */
const CONTACT = 'https://xo0449.github.io/#contact'

const SUBJECT = '반복되는 일 하나'

const BODY = [
  '무엇이 매번 반복되는지 한두 줄로 적어주세요.',
  '',
  '- 어떤 일인가요:',
  '- 얼마나 자주 하나요:',
  '- 지금은 어떻게 하고 있나요:',
  '',
].join('\n')

/**
 * 모듈 글 맨 아래에 붙는 물어보기 블록.
 *
 * 블로그에도 같은 것이 있다. 저장소가 둘이라 복사해 뒀다.
 * 스무 줄짜리를 공유하려고 패키지를 만들면 그쪽이 더 비싸다.
 * 문구를 고칠 때 두 군데를 고쳐야 한다는 것만 알고 있으면 된다.
 */
export default function Ask() {
  const mailto =
    `mailto:${EMAIL}` +
    `?subject=${encodeURIComponent(SUBJECT)}` +
    `&body=${encodeURIComponent(BODY)}`

  return (
    <aside className="ask">
      <h2>회사에서 반복되는 일 하나</h2>
      <p>
        무엇이 매번 반복되는지 한두 줄로 적어 보내주시면,
        자동으로 돌릴 수 있는 일인지 먼저 답을 드립니다.
        안 맞는 일이면 안 맞는다고 답합니다.
      </p>
      <div className="ask-actions">
        <a className="ask-button" href={mailto}>메일로 물어보기</a>
        <a className="ask-button ask-button-quiet" href={CONTACT}>Contact 페이지 보기</a>
      </div>
    </aside>
  )
}
