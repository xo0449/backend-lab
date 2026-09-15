DROP TABLE IF EXISTS delivery_outbox;
DROP TABLE IF EXISTS shipment;

CREATE TABLE shipment (
  id      INT PRIMARY KEY AUTO_INCREMENT,
  code    VARCHAR(40) NOT NULL,
  status  VARCHAR(20) NOT NULL
);

CREATE TABLE delivery_outbox (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  event_type  VARCHAR(50) NOT NULL,
  aggregate   VARCHAR(40) NOT NULL,
  payload     JSON NOT NULL,
  status      VARCHAR(20) NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_outbox_status (status, id)
);
