---
date: 2026-10-19
lastmod: 2026-10-19
tags:
draft: false
---
# RR이 RC보다 격리 수준이 "높다"는 건 무슨 뜻인가

격리 수준을 외울 때 "RU < RC < RR < SERIALIZABLE"이라는 순서만 외우기 쉽다. 그런데 면접에서 "RR이 왜 더 높은데요?"라고 물으면 **무엇으로부터 보호받는지**를 말할 수 있어야 한다. 그리고 "RR이면 외부 변경과 완전히 차단된다"고 말하면 바로 꼬리 질문에 걸린다. 그 함정까지 같이 정리해 둔다.

## "높다"의 의미: 다른 트랜잭션의 커밋에 덜 휘둘린다

격리 수준이 높다는 건, 동시에 도는 다른 트랜잭션의 변경이 **내 트랜잭션 안의 읽기 결과에 덜 끼어든다**는 뜻이다. 등급마다 막아 주는 이상 현상이 하나씩 늘어난다.

| 수준 | Dirty Read | Non-Repeatable Read | Phantom Read |
|---|---|---|---|
| READ UNCOMMITTED | 발생 | 발생 | 발생 |
| READ COMMITTED (RC) | 막음 | 발생 | 발생 |
| REPEATABLE READ (RR) | 막음 | 막음 | 표준상 발생 (InnoDB는 일반 SELECT에서 대부분 막음) |
| SERIALIZABLE | 막음 | 막음 | 막음 |

RC와 RR의 차이는 결국 **"읽을 때 어느 시점의 스냅샷을 보느냐"** 하나다.

- **RC**: SELECT 문을 실행할 **때마다** 그 순간까지 커밋된 최신 스냅샷을 새로 만든다.
- **RR**: 트랜잭션 안에서 만든 **첫 스냅샷을 끝까지 재사용**한다.

## 잔액 예시로 보기

A 계좌 잔액이 10,000원이다. 내 트랜잭션이 두 번 조회하는 사이에, 다른 트랜잭션이 5,000원으로 바꾸고 커밋한다.

```sql
-- T1 (나)
BEGIN;
SELECT balance FROM account WHERE id = 'A';  -- 10,000

        -- T2
        UPDATE account SET balance = 5000 WHERE id = 'A';
        COMMIT;

SELECT balance FROM account WHERE id = 'A';  -- RC: 5,000 / RR: 10,000
COMMIT;
```

| | RC | RR |
|---|---|---|
| 1차 조회 | 10,000 | 10,000 |
| T2가 5,000으로 수정 후 커밋 | | |
| 2차 조회 | **5,000** (새 스냅샷) | **10,000** (첫 스냅샷 재사용) |
| 결과 | Non-Repeatable Read 발생 | 같은 조회는 같은 결과 |

같은 트랜잭션에서 같은 SELECT를 두 번 했는데 값이 달라지는 게 RC의 Non-Repeatable Read다. RR은 이걸 막으니 "더 높다"고 한다.

## 어떻게 옛 값을 보여 주나: MVCC

RR이 T2의 커밋 이후에도 10,000을 보여 줄 수 있는 건 DB가 **이전 버전을 지우지 않고 남겨 두기 때문**이다(MVCC, Multi-Version Concurrency Control). 덕분에 읽기가 쓰기를 기다리지 않고, 쓰기도 읽기를 막지 않는다.

옛 버전을 어디에 두는지는 DB마다 다르다. "Undo에서 이전 값을 역추적한다"는 설명은 InnoDB·Oracle 계열에만 맞는다.

| | MySQL InnoDB · Oracle · Tibero | PostgreSQL |
|---|---|---|
| 옛 버전 위치 | 언두(Undo) 영역 | 테이블 안에 옛 행(튜플)을 그대로 남김 |
| 옛 값 읽는 법 | 최신 행에서 언두를 따라 거꾸로 재구성 | 각 행의 xmin/xmax로 "내 스냅샷에 보이는 행"을 고름 |
| 정리 | 아무도 안 보는 언두를 purge | VACUUM이 옛 튜플 정리 |

## 함정: RR이어도 "외부와 완전히 차단"은 아니다

여기가 꼬리 질문 포인트다. RR이 보장하는 건 **일반 SELECT(consistent read)가 같은 스냅샷을 본다**는 것까지다.

**1. 스냅샷 시점은 `BEGIN`이 아니라 첫 읽기다 (InnoDB)**

InnoDB RR의 스냅샷은 `BEGIN` 순간이 아니라 트랜잭션 안의 **첫 번째 일반 SELECT** 때 만들어진다. `BEGIN` 직후 아무것도 안 읽은 사이에 남이 커밋한 변경은 보인다. `BEGIN` 시점에 바로 스냅샷을 잡으려면 `START TRANSACTION WITH CONSISTENT SNAPSHOT`을 쓴다.

**2. 쓰기와 잠금 읽기는 스냅샷이 아니라 최신 값을 본다**

`UPDATE`, `DELETE`, `SELECT ... FOR UPDATE`는 스냅샷이 아니라 **지금 커밋된 최신 행**을 대상으로 한다(current read).

```sql
-- T1 (RR)
BEGIN;
SELECT balance FROM account WHERE id = 'A';             -- 10,000 (스냅샷)
        -- T2: balance = 5000 으로 수정 후 COMMIT
SELECT balance FROM account WHERE id = 'A';             -- 10,000 (여전히 스냅샷)
SELECT balance FROM account WHERE id = 'A' FOR UPDATE;  -- 5,000  (최신 값)
UPDATE account SET balance = balance - 1000 WHERE id = 'A';  -- 5,000 기준으로 계산 → 4,000
```

그래서 RR이라도 "읽은 값으로 계산해서 덮어쓰기" 패턴은 Lost Update가 날 수 있다.

```java
// before: RR이어도 위험 — 두 트랜잭션이 같은 10,000을 읽고 각자 덮어씀
long balance = repo.findBalance(id);    // 스냅샷 읽기
repo.updateBalance(id, balance - 1000); // 남의 차감이 사라질 수 있음

// after: 잠금 읽기로 최신 값을 잡고 계산하거나, DB에서 바로 계산
long balance = repo.findBalanceForUpdate(id);  // SELECT ... FOR UPDATE
// 또는 UPDATE account SET balance = balance - 1000 WHERE id = ?
```

**3. Phantom은 읽기 방식에 따라 다르다**

일반 SELECT는 스냅샷이라 새로 들어온 행이 안 보인다. 잠금 읽기(`FOR UPDATE`)는 InnoDB가 넥스트 키 락(레코드 + 그 앞 간격을 함께 잠그는 락)으로 범위에 새 행이 끼어드는 걸 막는다. 다만 한 트랜잭션 안에서 일반 SELECT와 잠금 읽기를 섞으면, 두 결과의 행 수가 다르게 보일 수 있다.

**4. 같은 RR이라도 DB마다 동작이 다르다**

PostgreSQL의 RR은 스냅샷 격리(Snapshot Isolation)라 Phantom도 보이지 않는다. 대신 내가 읽은 뒤 남이 고친 행을 내가 다시 고치려 하면, 기다렸다 덮어쓰지 않고 **직렬화 에러를 내고 트랜잭션을 실패시킨다**. 애플리케이션이 재시도해야 한다. InnoDB는 같은 상황에서 최신 값 기준으로 그냥 진행한다.

## 그럼 왜 다들 RR을 안 쓰나

높을수록 무조건 좋은 게 아니다. 오래 열린 트랜잭션이 첫 스냅샷을 쥐고 있으면, DB는 그 시점 이후의 옛 버전을 계속 보관해야 한다. InnoDB는 언두가 쌓이고, PostgreSQL은 VACUUM이 옛 튜플을 못 치워 테이블이 부푼다. 기본값도 그래서 갈린다.

| DB | 기본 격리 수준 |
|---|---|
| MySQL InnoDB | RR |
| Oracle · Tibero · PostgreSQL | RC |

같은 로직이 MySQL(RR)에서는 두 번째 조회 값이 그대로인데, Tibero·PostgreSQL(RC)에서는 바뀔 수 있다. 여러 DB를 다루는 시스템이라면 이 차이를 알고 있어야 한다.

## 한 줄 정리
> RR이 RC보다 높은 이유는, RC는 SELECT마다 새 스냅샷을 보고 RR은 첫 스냅샷을 끝까지 재사용해서 다른 트랜잭션의 커밋에 덜 휘둘리기 때문이다. 다만 이건 일반 SELECT에만 해당한다. UPDATE·FOR UPDATE는 최신 값을 보므로, RR도 "외부와 완전히 차단"된 건 아니다.
