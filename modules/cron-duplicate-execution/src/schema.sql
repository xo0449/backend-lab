DROP TABLE IF EXISTS discount_item;
DROP TABLE IF EXISTS discount_condition;
DROP TABLE IF EXISTS item;

CREATE TABLE discount_condition (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(64) NOT NULL,
  min_price   INT NOT NULL
);

CREATE TABLE item (
  id     INT PRIMARY KEY AUTO_INCREMENT,
  price  INT NOT NULL
);

CREATE TABLE discount_item (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  condition_id  INT NOT NULL,
  item_id       INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
