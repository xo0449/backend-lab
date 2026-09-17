const EMAIL = 'dreamjh1111@gmail.com'

/** 이 저장소에는 Contact 페이지가 없다. 블로그 쪽 것을 가리킨다. */
const CONTACT = 'https://xo0449.github.io/#contact'

const SUBJECT = '커피챗'

const BODY = [
  '안녕하세요.',
  '',
  '- 어떤 이야기를 나누고 싶으신지:',
  '- 편한 시간대:',
  '',
].join('\n')

/**
 * 모듈 글 맨 아래에 붙는 커피챗 블록.
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
      <h2>커피챗 환영합니다</h2>
      <p>
        원인이 나올 때까지 파보는 걸 좋아합니다.
        이 모듈들도 대부분 그렇게 나왔습니다.
      </p>
      <div className="ask-actions">
        <a className="ask-button" href={mailto}>메일 보내기</a>
        <a className="ask-button ask-button-quiet" href={CONTACT}>Contact 보기</a>
      </div>
    </aside>
  )
}
