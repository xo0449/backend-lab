DROP TABLE IF EXISTS event_outbox;
DROP TABLE IF EXISTS `order`;

CREATE TABLE `order` (
  id      INT PRIMARY KEY AUTO_INCREMENT,
  amount  INT NOT NULL,
  status  VARCHAR(20) NOT NULL
);

CREATE TABLE event_outbox (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  event_type  VARCHAR(100) NOT NULL,
  dedup_key   VARCHAR(160) NULL,
  payload     JSON NOT NULL,
  status      VARCHAR(20) NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_outbox_dedup (dedup_key),
  KEY idx_outbox_status_created (status, created_at)
);
