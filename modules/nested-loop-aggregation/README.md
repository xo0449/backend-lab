# 현황 화면 집계가 12억 행을 읽던 문제

## 고민

혜택별 소진액을 보여주는 현황 화면이 있다. 소진액은 결제 내역을
합친 값이라 미리 계산해두거나, 볼 때마다 집계하거나 둘 중 하나다.

볼 때마다 집계하는 쪽을 골랐다고 하자. 정합성 문제가 없고 코드가 단순하다.
혜택이 수십 건일 때는 아무 문제가 없다. 혜택 1,500건에 결제 80만 건이
되면 이야기가 달라진다.

실제로 확인해보고 싶었던 것은 따로 있었다.
**읽는 행을 줄이면 항상 빨라지는가.** 결론부터 말하면 아니었다.

## 재현

```bash
npm run db:up
npx tsx modules/nested-loop-aggregation/bench/seed.ts
npx tsx modules/nested-loop-aggregation/bench/measure.ts
```

혜택 1,500건, 결제 80만 건. 개선 전 쿼리는 상관 서브쿼리다.

```sql
SELECT b.id, b.name, b.budget,
  (SELECT COALESCE(SUM(p.discount), 0)
     FROM payment p
    WHERE p.benefit_id = b.id AND p.refunded = 0) AS consumed
FROM benefit b
```

실행 계획을 보면 원인이 바로 나온다.

```
-> Table scan on b  (cost=152 rows=1500)
-> Select #2 (subquery in projection; dependent)
    -> Aggregate: sum(p.discount)
        -> Filter: ((p.refunded = 0) and (p.benefit_id = b.id))
            -> Table scan on p  (cost=73189 rows=798375)
```

`dependent`가 핵심이다. 혜택 한 건마다 결제 테이블 전체를 훑는다.
1,500 × 798,375이면 약 12억 행이다.

## 접근

다섯 단계로 나눠 적용했다. 한 번에 다 바꾸면 무엇이 효과가 있었는지
알 수 없다.

### 1. 파생테이블 실체화

집계를 서브쿼리에서 꺼내 파생테이블로 만들었다.
결제 테이블을 한 번만 훑어 혜택별로 접어두고 그 결과를 혜택에 붙인다.

```sql
LEFT JOIN (
  SELECT benefit_id, SUM(discount) AS consumed
    FROM payment WHERE refunded = 0
   GROUP BY benefit_id
) c ON c.benefit_id = b.id
```

12억 행에서 157만 행으로. 실행 시간은 118초에서 164ms로 떨어졌다.
**이 한 단계가 전체 개선의 대부분을 차지한다.**

### 2. 기간 필터

현황 화면은 특정 월만 본다. 전 기간을 집계할 이유가 없었다.
87만 행, 116ms.

### 3. 기간 인덱스 — 여기서 예상이 빗나갔다

`(paid_at, refunded)` 인덱스를 걸었다.
읽은 행은 87만에서 13.6만으로 줄었다. 그런데 실행 시간은 거의 그대로였다.
측정을 반복하면 오히려 느려지는 경우도 있었다.

실행 계획을 보면 이유가 보인다.

```
-> Index range scan on payment using idx_payment_paid_at_refunded
   (cost=62055 rows=137900) (actual time=0.0321..107 rows=66667)
```

인덱스로 대상 행을 찾는 것까지는 좋은데, `SUM(discount)`를 계산하려면
`discount` 값이 필요하다. 인덱스에 없으니 행마다 테이블로 다시 간다.
6만 6천 번의 랜덤 접근이 생긴다. 순차 스캔 87만 행보다 이게 더 비쌌다.

**읽은 행 수는 비용의 일부일 뿐이다.** 어떻게 읽는지가 더 중요할 때가 있다.

### 4. 커버링 인덱스

쿼리가 쓰는 컬럼을 전부 인덱스에 넣었다.

```sql
CREATE INDEX idx_payment_covering
  ON payment (paid_at, refunded, benefit_id, discount)
```

인덱스만 읽고 끝나므로 테이블 접근이 사라진다.
읽은 행은 3단계와 같은 13.6만인데 실행 시간이 123ms에서 21ms가 됐다.
3단계와 4단계의 차이가 랜덤 접근 비용 그 자체다.

### 5. 짧은 캐시와 진행 중 요청 공유

여기까지 와도 남는 문제가 있다. 여러 사용자가 동시에 화면을 열면
같은 집계가 동시에 여러 번 돈다.

TTL 캐시만 두면 캐시가 비는 순간 몰려든 요청이 전부 DB로 간다.
그래서 진행 중인 작업을 들고 있다가 뒤따라온 요청에 같은 것을 준다.

```typescript
async get(load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  if (this.value && this.value.expiresAt > now) return this.value.data
  if (this.inFlight) return this.inFlight   // 진행 중이면 그것을 공유한다
  ...
}
```

동시 요청 8건에 DB 조회는 1회다.

## 결과

| 단계 | 읽은 행 | 실행 시간 |
|---|---:|---:|
| 개선 전 (상관 서브쿼리) | 1,200,006,003 | 118,888ms |
| 1. 파생테이블 실체화 | 1,565,857 | 164ms |
| 2. 기간 필터 | 869,924 | 116ms |
| 3. 기간 인덱스 | 136,589 | 123ms |
| 4. 커버링 인덱스 | 136,589 | 21ms |
| 5. 캐시 (동시 8건) | 136,589 | 20ms |

읽은 행 8,800배 감소, 실행 시간 5,600배 감소.

측정은 재현 가능하다. 시드와 측정 스크립트가 저장소에 있다.
숫자는 로컬 Docker MySQL 8.0.39, 버퍼 풀 128MB 기준이다.

## 다시 한다면

**실행시간 가드를 먼저 넣는다.** 이 쿼리는 2분 가까이 DB를 붙잡는다.
사용자가 화면을 여러 번 열면 그만큼 쌓인다. 쿼리를 고치는 것보다
`MAX_EXECUTION_TIME`을 거는 게 훨씬 빠르고, 최악을 막는다.
고치는 동안 서비스가 버틸 시간을 벌어준다.
`src/queries.ts`의 `DERIVED_PERIOD_GUARDED`가 그 형태다.

**실시간 집계가 항상 틀린 것은 아니다.** 대상이 수십 건이고 조회가
드물면 미리 계산해두는 쪽이 오히려 나쁘다. 갱신 시점을 관리해야 하고
정합성이 깨질 여지가 생긴다. 경계는 데이터 증가 속도에 있다.
처음부터 집계 테이블을 만들었다면 아마 과했을 것이다.
문제는 수십 건이 1,500건이 되는 동안 쿼리를 다시 보지 않은 것이다.

**측정 없이 인덱스를 걸지 않는다.** 3단계가 그 사례다.
"인덱스를 걸었더니 읽는 행이 줄었다"까지만 보고 끝냈다면
개선했다고 착각한 채 넘어갔을 것이다. 실제로는 아무것도
나아지지 않았다.
