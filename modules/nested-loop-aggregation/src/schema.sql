DROP TABLE IF EXISTS payment;
DROP TABLE IF EXISTS benefit;

CREATE TABLE benefit (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(64) NOT NULL,
  starts_on   DATE NOT NULL,
  ends_on     DATE NOT NULL,
  budget      BIGINT NOT NULL
);

CREATE TABLE payment (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  benefit_id    INT NOT NULL,
  amount        INT NOT NULL,
  discount      INT NOT NULL,
  refunded      TINYINT NOT NULL DEFAULT 0,
  paid_at       DATETIME NOT NULL
);

-- 인덱스를 일부러 넣지 않는다.
-- 개선 단계에서 무엇이 얼마나 기여하는지 나눠 보기 위함이다.
