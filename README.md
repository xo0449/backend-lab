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
| [switch로 범벅된 버전 분기를 표로 옮기기](modules/version-dispatch) | 실험 | 분기를 코드에서 데이터로 옮기면 무엇이 달라지는가 |
| [트랜잭션 안에서 외부 서버를 부르면 생기는 일](modules/outbox-vs-direct) | 실험 | 외부 호출을 트랜잭션 밖으로 밀어내면 무엇을 얻고 무엇을 떠안는가 |
| [아웃박스, CDC, 카프카로 이벤트를 전달하는 세 가지 방법](modules/delivery-comparison) | 실험 | 재시도와 유실 관점에서 세 방식은 무엇이 다른가 |
| [같은 로직을 여러 서비스에 담는 네 가지 방법](modules/shared-code-strategies) | 실험 | 버전을 고정할 수 있다는 것은 장점인가 부채인가 |
| [브라우저와 서버가 같은 이벤트를 보낼 때의 수집 구조](modules/analytics-ingest) | 실험 | 수집 경로를 하나로 둘 것인가 프로듀서에 따라 나눌 것인가 |
| [같은 이벤트를 어떻게 쌓느냐에 따라 읽는 값이 달라진다](modules/event-storage-layout) | 실험 | 이벤트를 어떤 모양으로 쌓아야 나중에 싸게 읽는가 |
| [적재하지 않고 물어볼 때, 어떻게 묻느냐가 값을 정한다](modules/query-without-loading) | 실험 | 웨어하우스를 들이지 않고 저장소에서 바로 읽을 때 무엇이 값을 정하는가 |
| [경로가 둘이면 고장도 둘인데, 둘 다 조용히 고장 난다](modules/dual-write-reconcile) | 실험 | 적재 경로가 둘일 때 한쪽만 끊긴 것을 어떻게 알아채는가 |
| [어제 밤 스냅샷으로 오늘 아침에 답하면 매출이 14.5% 높게 나온다](modules/order-join-freshness) | 실험 | 운영 DB의 사실을 분석 쪽으로 어떻게 가져올 것인가 |
| [저장은 한 벌, 계산은 여러 개로 나누면 얼마나 달라지는가](modules/workload-isolation) | 실험 | 성격이 다른 작업이 같이 돌 때 데이터를 복사하지 않고 어떻게 나눌 것인가 |

## 실행

```bash
git clone https://github.com/xo0449/backend-lab.git
cd backend-lab && npm install
npm run db:up
npm test
```

MySQL, Redis, MinIO, 카프카가 Docker로 뜹니다.

각 모듈의 측정은 바로 재현할 수 있습니다.

```bash
npm run lab:aggregation   # 12억 행 집계
npm run lab:cron          # 크론 중복 실행
npm run lab:version       # 버전 분기 전수 비교
npm run lab:collector     # 스키마 변경 실험
npm run lab:sdk           # SDK 안전장치와 번들 크기
npm run lab:outbox        # 아웃박스와 직접 호출
npm run lab:delivery      # 아웃박스, CDC, 카프카 비교
npm run lab:sharing       # 서브모듈, 패키지, 모노레포 비교
npm run lab:ingest        # 브라우저와 서버의 이벤트 수집 경로
npm run lab:layout        # 이벤트 저장 모양 네 가지 비교
npm run lab:query         # 적재 없이 저장소에서 바로 읽기
npm run lab:dual          # 이중 전송 대조
npm run lab:orders        # 운영 DB 조인과 신선도
npm run lab:isolation     # 배치와 조회의 자원 분리
```

각 모듈 README 맨 아래의 "직접 실행해보기"에 케이스별 명령이 있습니다.

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
