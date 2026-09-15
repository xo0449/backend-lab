# backend-lab

백엔드에서 마주치는 문제를 하나씩 재현하고 고쳐보는 저장소입니다.

각 모듈은 문제를 코드로 재현하고, 측정하고, 개선한 뒤 다시 측정한
기록을 남깁니다. 기능을 만들어보는 모듈도 있습니다. 그 경우에는
측정 대신 무엇을 고민했고 왜 그렇게 정했는지를 적습니다.

→ **[모듈 둘러보기](https://xo0449.github.io/backend-lab/)**

## 모듈

| 모듈 | 종류 | 고민 |
|---|---|---|
| [현황 화면 집계가 12억 행을 읽던 문제](modules/nested-loop-aggregation) | 실험 | 읽는 행을 줄이면 항상 빨라지는가 |
| [다중 인스턴스에서 크론이 중복 실행되는 문제](modules/cron-duplicate-execution) | 실험 | 왜 유니크 제약이나 분산 락이 아니라 DB 네임드 락인가 |
| [이벤트 수집 파이프라인](modules/event-collector) | 구현 | 이벤트 유실과 중복 중 무엇을 먼저 포기할 것인가 |
| [이벤트 SDK](modules/event-sdk) | 구현 | 분석 코드가 서비스를 내리지 않게 하려면 무엇을 포기해야 하는가 |

## 실행

```bash
npm install
npm run db:up
npm test
```

MySQL과 MinIO가 Docker로 뜹니다. 각 모듈의 측정을 재현하려면
해당 폴더의 README를 참고하세요.

## 구조

```
modules/<slug>/     모듈 하나. 폴더를 추가하면 목록에 나타납니다
  meta.json         메타데이터. 고민 항목은 비울 수 없습니다
  README.md         고민, 접근, 결과, 다시 한다면
shared/             모듈 메타데이터 규약과 검증
web/                모듈 목록과 상세를 보는 화면
```

메타데이터 검증은 `shared/module-meta.ts`에 있고 웹 빌드가 이를 실행합니다.
고민 항목이 비어 있으면 빌드가 실패합니다.
