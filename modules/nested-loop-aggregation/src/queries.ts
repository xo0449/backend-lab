/**
 * 개선 전. 혜택별 소진액을 상관 서브쿼리로 집계한다.
 *
 * 혜택 한 건마다 결제 테이블을 훑는다. 혜택 1,500건 x 결제 80만 건이면
 * 읽는 행이 12억에 가까워진다.
 */
export const NAIVE = `
  SELECT b.id, b.name, b.budget,
    (SELECT COALESCE(SUM(p.discount), 0)
       FROM payment p
      WHERE p.benefit_id = b.id AND p.refunded = 0) AS consumed
  FROM benefit b
`

/**
 * 1단계. 집계를 파생테이블로 분리해 실체화한다.
 *
 * 결제 테이블을 한 번만 훑어 혜택별로 접어두고, 그 결과를 혜택에 붙인다.
 * 중첩 루프가 사라진다.
 */
export const DERIVED = `
  SELECT b.id, b.name, b.budget, COALESCE(c.consumed, 0) AS consumed
  FROM benefit b
  LEFT JOIN (
    SELECT benefit_id, SUM(discount) AS consumed
      FROM payment
     WHERE refunded = 0
     GROUP BY benefit_id
  ) c ON c.benefit_id = b.id
`

/**
 * 2단계. 조회 기간으로 결제를 좁힌다.
 *
 * 현황 화면은 특정 월만 본다. 전체 기간을 집계할 이유가 없다.
 */
export const DERIVED_PERIOD = `
  SELECT b.id, b.name, b.budget, COALESCE(c.consumed, 0) AS consumed
  FROM benefit b
  LEFT JOIN (
    SELECT benefit_id, SUM(discount) AS consumed
      FROM payment
     WHERE refunded = 0 AND paid_at >= ? AND paid_at < ?
     GROUP BY benefit_id
  ) c ON c.benefit_id = b.id
`

/** 3단계. 실행시간 가드. 폭주해도 30초에서 끊는다. */
export const DERIVED_PERIOD_GUARDED = `
  SELECT /*+ MAX_EXECUTION_TIME(30000) */
         b.id, b.name, b.budget, COALESCE(c.consumed, 0) AS consumed
  FROM benefit b
  LEFT JOIN (
    SELECT benefit_id, SUM(discount) AS consumed
      FROM payment
     WHERE refunded = 0 AND paid_at >= ? AND paid_at < ?
     GROUP BY benefit_id
  ) c ON c.benefit_id = b.id
`

/**
 * 3단계. 기간 조건을 받쳐주는 인덱스.
 * 읽는 행은 줄지만 discount를 테이블에서 다시 읽어야 해서 느려질 수 있다.
 */
export const INDEX_RANGE =
  'CREATE INDEX idx_payment_paid_at_refunded ON payment (paid_at, refunded)'

/**
 * 4단계. 커버링 인덱스. 쿼리가 쓰는 컬럼을 전부 담는다.
 * 인덱스만 읽고 끝나므로 테이블 랜덤 접근이 사라진다.
 */
export const INDEX_COVERING =
  'CREATE INDEX idx_payment_covering ON payment (paid_at, refunded, benefit_id, discount)'
