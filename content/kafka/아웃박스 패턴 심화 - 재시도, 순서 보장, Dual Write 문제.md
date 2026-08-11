---
date: 2026-08-11
lastmod: 2026-08-11
tags:
draft: false
---
# 아웃박스 패턴 심화 - 재시도, 순서 보장, Dual Write 문제

관련: [[레거시 알림톡 시스템 → Kafka 기반 이벤트 아키텍처 전환]] — 거기서 정리한 outbox 기본 개념(Sender/outbox 테이블/Message relay)을 전제로, 실무에서 이걸 어떻게 더 단단하게 만드는지를 정리한다.

## Dual Write 문제부터 다시 짚기

outbox 패턴이 왜 필요한지는 "DB 쓰기"와 "카프카 발행"을 그냥 나란히 호출하면 뭐가 문제인지부터 봐야 이해가 된다.

```java
@Transactional
public void confirmReservation(Long id) {
    reservation.confirm();
    reservationRepository.save(reservation);   // (A) DB
    kafkaProducer.send(new ReservationConfirmedEvent(id)); // (B) 카프카 — 별개 시스템
}
```

`@Transactional`은 DB만 커버하고 카프카는 트랜잭션 범위 밖이라, (A)와 (B) 사이에 다음 두 방향의 불일치가 생길 수 있다.

- **(A) 성공, (B) 실패** → DB는 확정됐는데 아무도 모름. 다운스트림(알림, 재고 차감 등)이 조용히 안 돌아가는, 가장 흔하고 위험한 케이스.
- **(A) 실패(롤백), (B) 먼저 성공** → 컨슈머는 이미 "확정됨" 이벤트를 처리(예: 확정 메일 발송)했는데 DB는 롤백됨. 시스템끼리 서로 다른 얘기를 하는 상태.

두 시스템(DB, 카프카)에 대한 쓰기를 하나의 트랜잭션처럼 묶을 방법이 없어서 생기는 문제라 **dual write 문제**라고 부른다.

## Outbox 패턴의 재정식화

outbox 패턴의 본질은 "두 시스템에 대한 원자적 쓰기"라는 어려운 문제를, **"한 시스템(DB)에 대한 원자적 쓰기 + 별도의 안정적인 재시도 가능한 비동기 전달"**이라는 훨씬 쉬운 문제로 바꿔치기하는 것이다.

- 원래 트랜잭션 안에는 DB 쓰기 두 개(비즈니스 엔티티 변경 + outbox row insert)만 있음 → 같은 DB니까 원자성은 공짜.
- 트랜잭션 커밋되면 outbox row가 반드시 존재 → 카프카 발행이 몇 번을 실패하든 이 row가 남아있는 한 재시도 폴러가 결국 발행함(유실이 "지연"으로 격하됨).
- 대신 "카프카 발행"과 "outbox 상태 업데이트"는 여전히 별도 트랜잭션 → 이 지점에서 남는 리스크는 **유실이 아니라 중복**.

## Outbox 이벤트 상태 설계 — PENDING vs FAILED

재시도 로직을 상태로 어떻게 표현하는지가 핵심이다.

| 상황 | 상태 | 이유 |
|---|---|---|
| 발행 성공 | `SUCCESS` | 끝 |
| 발행 실패, 재시도 횟수 남음 | `PENDING` 유지 | 일시적 장애일 수 있으니 재시도 폴러가 다시 집어가야 함. `next_retry_at`을 지수 백오프로 미룸 |
| 발행 실패, 재시도 소진 | `FAILED` | 자동 재시도로는 더 이상 해결 안 됨 → 알림/수동 개입(DLQ 등) 대상 |

즉 `FAILED`는 "한 번 실패함"이 아니라 **"재시도를 다 썼는데도 실패함"**이라는 종료 상태로 써야 한다. 중간에 실패했다고 바로 `FAILED`로 보내면 재시도 폴러의 조회 대상(`status=PENDING`)에서 빠져버려서 다시는 시도되지 않는다.

### 재시도해도 의미 없는 예외는 예외

직렬화 실패, 메시지 크기 초과처럼 **몇 번을 재시도해도 절대 성공 못하는 예외**는 `retryCount`를 소진할 때까지 기다릴 필요 없이 즉시 `FAILED`로 보내야 한다. 이걸 구분하려면 예외를 Retriable/Non-retriable로 나눈다 (카프카 클라이언트는 `RetriableException` 마커 클래스로 이미 구분해줌).

```java
try {
    producer.send(record).get();
} catch (ExecutionException e) {
    if (e.getCause() instanceof RetriableException) {
        throw new DownstreamCallFailedException(...);       // 재시도 대상 → PENDING
    }
    throw new DownstreamNonRetryableException(...);         // 재시도 무의미 → 즉시 FAILED
}
```

## 발행이 "동기처럼" 동작하는 이유 — acks

카프카 프로듀서의 `send()`는 원래 비동기(Future 반환)지만, outbox 릴레이는 보통 `.get(timeout)`으로 블로킹해서 그 자리에서 성공/실패를 확정한다. 그런데 이 ack가 뭘 보장하는지는 `acks` 설정에 달려있다.

- `acks=0`: 응답 확인 안 함 → outbox 발행용으로는 쓰면 안 됨.
- `acks=1`: 리더 브로커만 받으면 ack → 리더가 ack 직후 죽고 복제 전이면 유실 가능.
- `acks=all` + `min.insync.replicas>=2`: 리더+복제본 다수가 받아야 ack → 유실 확률이 실질적으로 0에 수렴.

**`acks=all`이 outbox 패턴의 신뢰성을 받쳐주는 전제 조건**이다. 여기가 약하면 그 위에 뭘 쌓아도 소용없다.

## 중복 발행과 멱등성

ack 자체가 네트워크에서 유실되는 경우(브로커는 저장했는데 응답을 못 받음)는 완전히 막을 수 없다. 이러면 outbox는 실패로 보고 재시도하고, 결과적으로 같은 이벤트가 두 번 발행된다. 이건 **막는 게 아니라 뒷단에서 흡수**하는 게 실무 해법이다.

1. **프로듀서 멱등성**(`enable.idempotence=true`): 프로듀서-브로커 간 네트워크 재시도로 인한 중복은 브로커가 시퀀스 번호로 자동 dedupe.
2. **컨슈머 멱등 소비**: 앱 재시작 후 완전히 새 세션으로 재발행되는 것처럼 프로듀서 멱등성으로도 못 막는 중복은, 메시지 키(=outbox event id)를 기준으로 컨슈머가 "이미 처리한 이벤트인지" 체크해서 무해화.

즉 outbox 패턴은 **exactly-once가 아니라 at-least-once + 컨슈머 멱등성**으로 정확성을 확보하는 모델이다.

## 발행 순서 보장

outbox 릴레이는 `ORDER BY id ASC`로 생성 순서대로 읽어서 그 순서 그대로 발행한다. 이때 **메시지 키를 aggregate id(예: reservationId)로 고정**하면, 카프카는 같은 키를 같은 파티션에 넣고 파티션 내부는 발행 순서가 보장되므로 "같은 엔티티에 대한 이벤트들"의 순서가 컨슈머까지 유지된다.

카프카가 보장하는 건 **파티션 단위 순서**지 전역 순서가 아니라는 점은 구분해서 기억.

## 폴링 vs CDC(Debezium) 릴레이

- **폴링**: 지금까지 얘기한 방식. 앱이 직접 outbox 테이블을 주기적으로 조회해서 발행 + 상태 업데이트.
- **CDC**: 앱이 발행을 아예 안 하고, Debezium 같은 커넥터가 DB의 binlog를 tail해서 커밋된 outbox row를 그대로 카프카로 포워딩. 발행 순서 = DB 커밋 순서가 자동으로 보장되고, "상태 컬럼" 개념 자체가 필요 없어짐(커넥터의 binlog offset이 진행 상황을 대신 관리). 대신 Kafka Connect 같은 별도 인프라가 필요.

## 한 줄 정리

> Outbox 패턴은 "DB 쓰기 + 카프카 발행"이라는 두 시스템 원자적 쓰기 문제를, "DB 원자적 쓰기 + 재시도 가능한 비동기 전달"로 바꿔서 유실은 없애고, 대신 남은 중복 가능성은 프로듀서 멱등성과 컨슈머 멱등 소비로 흡수하는 패턴이다.
