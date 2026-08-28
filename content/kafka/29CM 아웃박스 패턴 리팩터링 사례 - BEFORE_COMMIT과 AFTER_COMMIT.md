---
date: 2026-08-24
lastmod: 2026-08-24
tags:
draft: false
---
# 29CM 아웃박스 패턴 리팩터링 사례 — BEFORE_COMMIT과 AFTER_COMMIT을 함께 쓰기

관련: [[ApplicationEventPublisher와 TransactionalEventListener]] — 거기서 정리한 `@TransactionalEventListener`의 phase 메커니즘을 [29CM의 실제 구현 사례](https://medium.com/@greg.shiny82/%ED%8A%B8%EB%9E%9C%EC%9E%AD%EC%85%94%EB%84%90-%EC%95%84%EC%9B%83%EB%B0%95%EC%8A%A4-%ED%8C%A8%ED%84%B4%EC%9D%98-%EC%8B%A4%EC%A0%9C-%EA%B5%AC%ED%98%84-%EC%82%AC%EB%A1%80-29cm-0f822fc23edb)에 어떻게 적용했는지 정리한다. 이 리팩터링 이후 배포 중 카프카 전송이 유실되는 별도 문제는 [[Graceful Shutdown과 SIGTERM vs SIGKILL]]에서 다룬다.

**초기 설계**: 도메인 메서드(`@Transactional`) 하나 안에 세 가지를 전부 넣는다.

1. 비즈니스 로직 실행 (예: 주문 완료 처리)
2. 그 결과를 outbox 테이블에 INSERT (발행할 이벤트 정보 기록)
3. `ApplicationEventPublisher.publishEvent()`로 이벤트 발행 — 이건 인메모리 신호일 뿐, 카프카와 무관

1~3이 담긴 트랜잭션이 commit되면, 별도의 리스너(`phase = AFTER_COMMIT`)가 3번에서 발행된 이벤트를 받아 그제서야 실제로 카프카에 메시지를 보낸다. 즉 1~3번은 하나의 DB 트랜잭션으로 원자적으로 묶여 있고, 카프카 발행(4번)은 그 트랜잭션이 끝난 뒤 동작하는 별개의 후속 리스너다.

**최종 설계**: 도메인 메서드는 "① 비즈니스 로직 → ② 이벤트 발행"만 하고 끝낸다. 그 이벤트를 구독하는 리스너를 **두 개**로 쪼갠다.

- outbox 테이블 기록 → `phase = BEFORE_COMMIT` 리스너
- 카프카 발행 → `phase = AFTER_COMMIT` 리스너

핵심은 `BEFORE_COMMIT`이 트랜잭션이 아직 열려 있는 시점에 실행된다는 것 — 그 안에서 outbox 테이블에 쓰는 INSERT도 원래 도메인 트랜잭션에 그대로 합류된다. 그래서 "outbox 기록" 로직을 도메인 메서드 밖으로 완전히 빼내면서도, 원자성(도메인 로직 + outbox 기록이 같이 성공하거나 같이 실패)은 그대로 유지된다. 결과적으로 "이벤트 발행 이후에 처리되어야 할 모든 로직은 전부 리스너에 있다"는 일관된 구조가 된다.

## 이 리팩터링이 왜 더 나은가 — 기능은 같지만 일관성이 다르다

초기 설계와 최종 설계는 **기능적으로는 거의 동일하다**(둘 다 도메인 로직 + outbox 기록이 원자적으로 묶이고, 카프카 발행은 커밋 이후에 일어남). 차이는 순전히 "이벤트 발행 전/후의 경계가 얼마나 깔끔한가"에 있다.

- 초기 설계: 도메인 메서드 안에 일부 후속 로직(outbox 기록)이 남아있고, 일부(카프카 전송)만 리스너로 빠져 있다 → 이벤트 발행 전/후 경계가 애매하다.
- 최종 설계: "이벤트가 발행된 시점 이후에 일어나는 모든 일은 예외 없이 전부 `TransactionalEventListener`에서 처리한다"는 규칙이 깔끔하게 성립한다.

이건 [[ApplicationEventPublisher와 TransactionalEventListener#`ApplicationEventPublisher` — 스프링 내부 이벤트 발행기|ApplicationEventPublisher의 근본 취지]]와 그대로 맞닿아 있다 — 도메인 메서드는 도메인 요구사항 자체에만 집중하고, 그 이후에 뭘 더 해야 하든(outbox 기록이든 카프카 전송이든, 나중에 알림 발송이 추가되든) 전부 "이벤트를 구독하는 리스너를 하나 더 추가하는 것"으로 해결된다. 도메인 로직을 건드리지 않고도 후속 처리를 확장할 수 있는 구조가 되는 것 — 그래서 29CM은 기능이 동일함에도 이 구조를 응집성·확장성 측면에서 더 낫다고 판단해 채택했다.

## 변경 전/후 예시 코드

예약 확정 도메인으로 옮겨서 비교하면 이렇다.

**초기 설계** — 도메인 메서드 안에 outbox 기록까지 포함

```java
@Transactional
public void confirmReservation(Long reservationId) {
    // 1. 도메인 로직
    Reservation reservation = reservationRepository.findById(reservationId);
    reservation.confirm();

    // 2. outbox 테이블에 이벤트 기록 (도메인 메서드 안에서 직접)
    outboxRepository.save(OutboxEvent.of("ReservationConfirmed", reservation));

    // 3. 이벤트 발행 — 인메모리 신호일 뿐, 카프카와 무관
    eventPublisher.publishEvent(new ReservationConfirmedEvent(reservationId));
}

@Component
@RequiredArgsConstructor
public class ReservationKafkaPublisher {

    private final KafkaTemplate<String, String> kafkaTemplate;

    // 4. 카프카 전송 — 커밋 이후에만 동작
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void sendToKafka(ReservationConfirmedEvent event) {
        kafkaTemplate.send("reservation.confirmed", event.toPayload());
    }
}
```

**최종 설계** — 도메인 메서드는 이벤트 발행까지만, outbox 기록은 별도 리스너로

```java
@Transactional
public void confirmReservation(Long reservationId) {
    // 1. 도메인 로직만
    Reservation reservation = reservationRepository.findById(reservationId);
    reservation.confirm();

    // 2. 이벤트 발행
    eventPublisher.publishEvent(new ReservationConfirmedEvent(reservationId, reservation));
}

@Component
@RequiredArgsConstructor
public class ReservationOutboxRecorder {

    private final OutboxRepository outboxRepository;

    // outbox 기록을 전담 리스너로 분리 — 트랜잭션이 아직 열려있는 시점이라 원자성 유지됨
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void recordOutbox(ReservationConfirmedEvent event) {
        outboxRepository.save(OutboxEvent.of("ReservationConfirmed", event));
    }
}

@Component
@RequiredArgsConstructor
public class ReservationKafkaPublisher {

    private final KafkaTemplate<String, String> kafkaTemplate;

    // 카프카 전송은 기존과 동일 — 커밋 이후에만 동작
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void sendToKafka(ReservationConfirmedEvent event) {
        kafkaTemplate.send("reservation.confirmed", event.toPayload());
    }
}
```

바뀐 건 딱 하나 — outbox 기록이 도메인 메서드 밖으로 나와서 `ReservationConfirmedEvent`를 구독하는 리스너가 됐다는 것뿐이다. `confirmReservation()`은 이제 카프카는 물론 outbox 테이블의 존재도 전혀 몰라도 되고, 오직 "예약을 확정하고 이벤트를 발행한다"는 도메인 책임만 남는다.

## 한 줄 정리

> 29CM은 outbox 기록을 도메인 메서드에서 `BEFORE_COMMIT` 리스너로 옮겨, "이벤트 발행 이후의 모든 로직은 리스너에서 처리한다"는 일관된 구조로 리팩터링했다. 기능은 초기 설계와 동일하지만, 도메인 로직이 후속 처리를 전혀 몰라도 되는 확장성과 응집성을 얻었다.
