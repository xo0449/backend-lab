import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /**
     * 테스트 파일을 순차로 돌린다.
     *
     * 여러 모듈이 같은 MySQL과 MinIO를 쓴다. 병렬로 돌리면
     * 한 파일이 스키마를 다시 만드는 사이 다른 파일이 그 테이블을 읽는다.
     * 인프라를 파일마다 따로 띄우는 것보다 순차 실행이 싸다.
     */
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
