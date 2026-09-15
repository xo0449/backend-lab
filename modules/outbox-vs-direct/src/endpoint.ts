let port = 4801

/** 테스트가 다른 포트의 수신자를 쓸 수 있게 열어둔다. */
export function setReceiverPort(next: number) {
  port = next
}

export function endpoint(): string {
  return `http://127.0.0.1:${port}/events`
}
