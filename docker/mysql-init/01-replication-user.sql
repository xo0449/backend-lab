-- binlog를 읽는 CDC 실험용 계정.
-- 컨테이너를 처음 만들 때 한 번 실행된다.
-- 수동으로 만들게 두면 db:down 뒤에 테스트가 조용히 실패한다.
CREATE USER IF NOT EXISTS 'repl'@'%' IDENTIFIED WITH mysql_native_password BY 'repl';
GRANT REPLICATION SLAVE, REPLICATION CLIENT, SELECT ON *.* TO 'repl'@'%';
FLUSH PRIVILEGES;
