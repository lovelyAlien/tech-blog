---
date: 2026-10-16
lastmod: 2026-10-16
tags:
draft: false
---
# 대량 데이터는 왜 한 번에 조회하면 안 되고, Paging과 Cursor는 무엇이 다른가

"chunkSize를 1,000으로 잡았으니 메모리에는 1,000건만 있겠지"라고 생각하기 쉽다. 그런데 카카오페이 정산플랫폼팀 사례(Spring Batch Partitioning)에서는 바로 이 착각 때문에 OOM이 났다. 데이터를 **어떻게 읽느냐**가 메모리와 속도를 동시에 결정한다는 걸 정리한다.

## chunkSize는 메모리 상한이 아니다

Chunk는 실제로 이렇게 돈다. 1건씩 번갈아 도는 게 아니라, 단계마다 1,000건씩 몰아서 처리한다.

```
read × 1000번 → process × 1000번 → write(1000건 목록) 1번 → 커밋 → 다시 read
```

그래서 Chunk 하나만큼(1,000건)은 항상 메모리에 함께 올라가 있다. 하지만 chunkSize가 정하는 건 **Writer에 한 번에 넘기는 건수**뿐이다. Reader가 내부에서 DB로부터 얼마나 가져와 쥐고 있는지는 **Reader 구현**이 정한다.

```
[나쁜 Reader]
DB에서 하루치 300만 건을 한 번에 조회해 List로 메모리에 올림
  → 그 List에서 1건씩 꺼내 줌 (read)
  → Chunk는 1,000건씩 돌지만, 뒤에서 300만 건이 계속 메모리를 차지

스레드 6개 × 300만 건 = 1,800만 건이 한 힙에 → OOM
```

JVM 힙은 **실행할 때 크기가 정해진 그릇 하나**(`-Xmx4g` 등)이고, 모든 스레드가 함께 쓴다. 병렬로 돌리면 메모리 사용량도 **스레드 수만큼 곱해진다.** 그릇이 넘치면 넘치게 만든 스레드 하나가 아니라 JVM 전체가 죽는다.

> 원문은 "한 번에 조회하다 OOM이 났다"고만 쓰고, 원래 Reader가 정확히 어떤 구현이었는지는 밝히지 않는다. 위 그림은 그 설명을 바탕으로 한 해석이다.

## Paging — 매번 처음부터 센다

```sql
SELECT * FROM ledger ORDER BY id LIMIT 1000 OFFSET 0       -- 1번째 묶음
SELECT * FROM ledger ORDER BY id LIMIT 1000 OFFSET 999000  -- 1000번째 묶음
```

DB는 `OFFSET 999000`을 그냥 건너뛰지 못한다. 999,000번째가 어디인지 알려면 **처음부터 하나씩 세면서** 지나가야 한다. 쪽 번호가 없는 책에서 "1000쪽부터 읽어 줘"라는 부탁을 받으면 1쪽부터 세야 하고, 다음 날 "1001쪽부터"라는 부탁을 받으면 또 1쪽부터 세는 것과 같다.

| 몇 번째 묶음 | DB가 훑는 건수 |
|---|---|
| 1번째 | 1,000 |
| 500번째 | 500,000 |
| 1000번째 | 1,000,000 |

- 뒤로 갈수록 느려진다. 끝까지 읽으면 누적 비용이 O(N²)이다.
- **메모리는 늘지 않는다.** 돌려받는 건 항상 1,000건이다. 늘어나는 건 DB가 하는 일, 즉 **시간**이다.
- 쿼리를 매번 새로 보내고, 응답을 받으면 끝난다. 읽는 도중 데이터가 추가·삭제되면 중복이나 누락이 생길 수 있다.
- MongoDB의 `skip(N)`도 같다. 공식 문서도 offset이 커질수록 skip이 느려진다고 말한다.

## Cursor — DB 서버가 책갈피를 들고 있다

커서는 **DB 서버가 "어떤 조회를, 어디까지 줬는지" 기억해 두는 장치**다.

```
① 클라이언트: "이 조건으로 조회할게"
   DB 서버: 커서 #123 발급, 첫 1,000건 전달, 위치 = 1,000번째
② 클라이언트: "#123 다음 거 줘"   (MongoDB의 getMore)
   DB 서버: 기억해 둔 위치에서 바로 다음 1,000건 (처음부터 세지 않음)
③ ... 끝까지 반복
④ 클라이언트: "#123 닫아" → DB 서버가 커서를 버림
```

**커서 번호와 읽은 위치는 다르다.** 옷 보관소에 비유하면 번호표와 옷이다. 애플리케이션은 번호표(#123)만 들고 있고, 옷(조회 조건, 정렬, 읽은 위치)은 DB 서버가 보관한다.

```
[DB 서버 메모리]
  커서 #123 → { 조건: 3월 5일 원장, 정렬: 주문번호, 읽은 위치: 1,000번째 }

[Spring 애플리케이션]
  "#123"이라는 번호만 들고 있음
```

- 몇 번째 묶음이든 비용이 같다. 문서당 O(1), 전체 O(N)이다.
- 클라이언트 메모리에는 batchSize만큼만 올라온다.
- 대신 **끝날 때까지 커서를 열어 둬야** 한다.

### "커서를 열어 둔다"는 무슨 뜻인가

DB 서버 안에서 그 조회 작업을 끝내지 않고 살려 둔다는 뜻이다. 커넥션과의 관계는 DB마다 다르다.

| DB | 커서를 쓰는 동안 |
|---|---|
| MySQL 등 관계형 DB (JDBC) | **커넥션 하나를 계속 붙잡고 있다** |
| MongoDB | 커서가 커넥션과 별개로, 번호(ID)로 서버에 살아 있다. 오래 요청이 없으면 서버가 정리한다 (`noCursorTimeout`으로 막을 수 있음) |

공통으로 맞는 표현은 **"DB 서버 자원을 계속 차지한다"** 다. 그래서 다 쓰면 반드시 닫아야 한다.

### 눈으로 확인하기 (mongosh)

```js
const res = db.runCommand({ find: "ledger", filter: { date: "2025-03-05" }, batchSize: 2 })
res.cursor.id                                  // 서버가 발급한 커서 번호
res.cursor.firstBatch                          // 문서 2건

db.serverStatus().metrics.cursor.open.total    // 1 이상 → 서버에 커서가 살아 있음

db.runCommand({ getMore: res.cursor.id, collection: "ledger", batchSize: 2 })  // 다음 2건

db.runCommand({ killCursors: "ledger", cursors: [res.cursor.id] })              // 닫기
```

끝까지 다 읽으면 서버가 커서 번호를 `0`으로 돌려준다. "다 줬으니 내가 닫았다"는 뜻이다.

## Spring Batch 없이도 쓸 수 있다

커서는 DB의 기능이다. Spring Batch의 `MongoCursorItemReader`도 안에서는 Spring Data의 `stream()`을 감싼 것뿐이다.

```java
// Before: 전부 조회 — 300만 건이 List로 한꺼번에 메모리에 → OOM 위험
List<PaymentLedger> all = mongoTemplate.find(
        new Query(Criteria.where("date").is(date)), PaymentLedger.class);

// After: 커서 조회 — 1,000건씩 받아 오며 1건씩 처리
Query query = new Query(Criteria.where("date").is(date))
        .cursorBatchSize(1000);                       // 서버에서 한 번에 받아 올 묶음 크기

try (Stream<PaymentLedger> stream = mongoTemplate.stream(query, PaymentLedger.class)) {
    stream.forEach(this::handle);                     // 버퍼가 비면 드라이버가 알아서 getMore
}                                                     // try-with-resources로 닫아야 커서가 정리됨
```

코드는 `find`와 `stream` 한 단어 차이지만 메모리 사용량은 완전히 다르다. 관계형 DB에서는 `JdbcTemplate.queryForStream()`에 fetch size를 함께 설정하는 식으로 쓴다. 다만 MySQL은 드라이버 설정(`useCursorFetch=true` 등)을 해 줘야 실제로 조금씩 받아 온다. 설정하지 않으면 결국 전부 받아 온다.

Spring Batch가 여기에 더해 주는 건 Chunk 단위 트랜잭션, 실패 지점부터의 재시작, 파티셔닝 같은 실행 관리다.

## 세 가지 읽기 방식 비교

| 방식 | 애플리케이션 메모리 | 속도 |
|---|---|---|
| 한 번에 전부 조회 | ❌ 전부 올림 → **OOM 원인** | — |
| Paging (`OFFSET`, `skip`) | ✅ 페이지 크기만큼 | ❌ 뒤로 갈수록 느려짐 |
| Cursor | ✅ batchSize만큼 | ✅ 일정 |

OOM만 보면 Paging으로 바꿔도 해결된다. 사례에서 Cursor를 고른 건 수백만 건이면 Paging은 뒤쪽 묶음에서 너무 느려지기 때문이다.

## 이름 함정: "커서 기반 페이지네이션"은 다른 개념이다

[[복합 인덱스와 커서 기반 페이지네이션]]의 "커서 기반(keyset) 페이지네이션"은 `WHERE id > 마지막id LIMIT 1000`처럼 **마지막으로 본 값을 기준으로 다음 페이지를 조회하는 쿼리 방식**이다. 요청마다 쿼리를 새로 보낸다.

이 노트의 커서는 **DB 서버가 조회 상태를 메모리에 들고 있는 서버 사이드 커서**다. 둘 다 "OFFSET의 처음부터 세기를 피한다"는 목적은 같지만, 동작 방식이 전혀 다르다. 이름이 같아서 반드시 헷갈린다.

| | Keyset 페이지네이션 | 서버 사이드 커서 |
|---|---|---|
| 위치를 기억하는 쪽 | 클라이언트 (마지막 id) | DB 서버 |
| 요청 | 매번 새 쿼리 | 한 번 열고 "다음 거" 반복 |
| DB 자원 점유 | 요청할 때만 | 닫을 때까지 계속 |
| 주 용도 | API 무한 스크롤, 목록 화면 | 배치, 대량 스트리밍 |

## 내가 헷갈렸던 것

| 처음 이해 | 정확한 이해 |
|---|---|
| chunkSize 1,000이면 메모리에 1,000건만 있다 | Reader가 내부에서 전부 조회하면 수백만 건이 남는다 |
| Reader → Processor를 1건씩 번갈아 처리 | read 1,000번 → process 1,000번 → write 1번 |
| Paging은 뒤로 갈수록 메모리를 많이 쓴다 | 메모리는 같고 **느려진다** |
| 책갈피(읽은 위치)를 애플리케이션이 가진다 | 위치는 **DB 서버**가 갖고, 애플리케이션은 **커서 번호**만 가진다 |
| 커서를 열어 둔다 = 무조건 커넥션을 붙잡는다 | JDBC에서는 그렇다. MongoDB는 커서가 서버에 따로 산다. 공통점은 **DB 자원 점유** |

## 스스로 확인할 질문

- `LIMIT 1000 OFFSET 999000`을 받으면 DB는 몇 건을 훑는가? 왜?
- chunkSize가 1,000인데 OOM이 날 수 있는 이유는?
- 커서 번호와 읽은 위치는 각각 어디에 있는가?
- 100만 건을 1,000건씩 읽는 방법 세 가지(OFFSET, Keyset, Cursor)를 비교할 수 있는가?

## 확인 필요

- MongoDB 커서의 기본 타임아웃: 원문은 "30분간 활동이 없으면 타임아웃"이라고 쓴다. 내 기억으로는 커서가 10분(`cursorTimeoutMillis`), 세션이 30분이다. 공식 문서로 확인해 볼 것
- MySQL에서 `useCursorFetch=true`와 fetch size 설정 시 실제 동작 확인

## 한 줄 정리

> chunkSize는 쓰기 단위일 뿐 메모리 상한이 아니다. Paging은 메모리는 일정하지만 매번 처음부터 세서 느려지고, Cursor는 DB 서버가 위치를 기억해 메모리와 속도가 모두 일정하다. 대신 열어 둔 커서는 DB 자원을 차지하니 반드시 닫는다.

## 관련 노트

- [[Spring Batch Partitioning 면접 설명과 성능 결과 해석]]
- [[Spring Batch 개념과 Chunk 처리]]
- [[복합 인덱스와 커서 기반 페이지네이션]]
- [[경쟁 상태와 thread-safe]]
