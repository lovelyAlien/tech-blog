---
date: 2026-09-01
lastmod: 2026-09-01
tags:
draft: false
---
# 동시성 제어와 Kafka, MSA에서 실제로 어떻게 짜여있나

`hhplus-concert-reservation-system` — 8개 Spring Boot 서비스(Eureka/Gateway/대기열/예약/결제/알림/오케스트레이션/Redis 전담)로 쪼갠 콘서트 예약 MSA를 로컬에서 직접 띄우고, 코드를 파고들면서 확인한 내용. 스터디에서 "실제 코드가 어떻게 짜여있는지" 사례로 발표하기 좋을 것 같아 정리했다. 좋은 패턴과 허점을 같이 담았다 — 둘 다 배울 게 있어서다.

## 좌석 중복 예약 방지 — DB 비관적 락

핵심 코드 ([SimpleReservationCrudService.createTemporalReservation](reservation-service/src/main/java/io/reservationservice/api/business/service/impl/SimpleReservationCrudService.java#L64)):

```java
@Transactional
public TemporalReservationCreateInfo createTemporalReservation(ReservationCreateCommand command) {
    ConcertOption concertOption = concertOptionRepository.findByIdWithSLock(command.getConcertOptionId()); // S락
    Seat seat = seatRepository.findSingleByConditionWithLock(onConcertOptionSeat(concertOption, command.getSeatNumber())); // X락
    seatRepository.save(seat.doReserve());
    return TemporalReservationCreateInfo.from(temporalReservationRepository.save(create(command, concertOption, seat)));
}
```

- `concertOption`은 `PESSIMISTIC_READ`(S락, 공유 락)로 조회 — 여러 요청이 "같은 콘서트 옵션 읽기"는 동시에 가능하되, 쓰기와는 충돌하도록.
- `seat`은 `PESSIMISTIC_WRITE`(X락, 배타 락)로 조회 — 두 번째 요청은 여기서 첫 번째 트랜잭션이 커밋될 때까지 그대로 블로킹된다.
- 좌석 상태 체크와 변경이 `Seat.doReserve()` 한 메서드 안에서 원자적으로 일어남:

```java
public Seat doReserve() {
    if (isOccupied()) {
        throw new ReservationUnAvailableException(SEAT_ALREADY_RESERVED);
    }
    this.occupied = true;
    return this;
}
```

락을 이미 쥔 상태에서 체크+변경을 한 메서드 안에서 처리하니 check-then-act 사이 틈이 없다. 두 번째 스레드는 락이 풀리자마자 다시 읽어서 `occupied=true`를 보고 예외를 던진다 — 교과서적인 비관적 락 사용이다.

## 결제 잔액 차감 — 완전히 같은 골격

[SimpleBalanceUseManager.use](payment-service/src/main/java/io/paymentservice/api/balance/business/operators/balanceusemanager/SimpleBalanceUseManager.java#L26):

```java
@Transactional
public BalanceUseInfo use(BalanceUseCommand command) {
    Balance balance = balanceRepository.findSingleByConditionWithLock(onUser(command)); // PESSIMISTIC_WRITE
    balance.use(command.getAmount(), command.getTransactionReason());
    return BalanceUseInfo.from(balanceRepository.save(balance));
}
```

"락으로 row 잠그기 → 도메인 메서드로 상태 검증+변경 → 저장" 패턴이 좌석과 똑같이 반복된다. 흥미로운 지점은 `Balance`, `Seat` 엔티티 둘 다에 `@Version`(낙관적 락) 필드가 **주석 처리된 채 남아있다**는 것 — 낙관적 락도 고려했다가 비관적 락으로 확정한 흔적으로 보인다. 재시도 로직 없이 즉시 정합성이 필요하고, 임계 구역이 짧은 도메인이라 비관적 락 쪽이 맞는 선택이었을 것.

## 트랜잭셔널 아웃박스 패턴

일반론은 [[아웃박스 패턴 심화 - 재시도, 순서 보장, Dual Write 문제]]에 정리해뒀으니, 여기선 **이 프로젝트가 실제로 어떻게 구현했는지**만 짚는다.

예약 확정과 아웃박스 저장을 같은 트랜잭션에 넣는다 ([SimpleReservationCrudService.confirmReservation](reservation-service/src/main/java/io/reservationservice/api/business/service/impl/SimpleReservationCrudService.java#L79)):

```java
@Transactional
public ReservationConfirmInfo confirmReservation(Long temporalReservationId) {
    TemporalReservation temporalReservation = temporalReservationRepository.findById(temporalReservationId);
    temporalReservation.confirm();
    Reservation reservation = reservationRepository.save(temporalReservation.toConfirmedReservation());

    OutboxEvent outboxEvent = outboxRepository.save(createConfirmOutbox(reservation.toJson(), CONCERT_RESERVATION_CONFIRM.getValue()));
    applicationEventPublisher.publishEvent(outboxEvent); // 아직 발행 안 됨, 커밋 대기
    return ReservationConfirmInfo.from(reservation);
}
```

발행은 `@TransactionalEventListener(phase = AFTER_COMMIT)`로 커밋이 실제로 성공한 뒤에만 실행된다:

```java
@TransactionalEventListener(phase = AFTER_COMMIT)
public void handleOutboxEvent(OutboxEvent outboxEvent) {
    strategies.stream().filter(s -> s.supports(outboxEvent.getEventType()))
        .findFirst().ifPresentOrElse(s -> s.process(outboxEvent), ...);
}
```

`process()` 안에서 `streamBridge.send(...)`로 Kafka 발행. 여기서 실패해도 DB엔 이미 `OutboxEvent`가 `INIT` 상태로 남아있으니, `OutboxResendScheduler`가 5초마다 돌면서 **생성 5분 경과 + 미발행** 건을 찾아 재발행한다 — "먼저 DB에 확실히 기록하고, 발행은 별도로 보장한다"는 아웃박스 패턴의 정석 그대로다.

## 동시성 테스트 — 이중 CountDownLatch 배리어

[ConcurrentReservationApiStepDef](reservation-service/src/test/java/io/reservationservice/cucumber/steps/ConcurrentReservationApiStepDef.java#L33):

```java
ExecutorService executorService = Executors.newFixedThreadPool(numberOfRequests);
CountDownLatch latch = new CountDownLatch(1);                    // 시작 신호용
CountDownLatch doneLatch = new CountDownLatch(numberOfRequests); // 완료 대기용

for (Map<String, String> userInfo : userInfos) {
    executorService.submit(() -> {
        try {
            latch.await();  // 여기서 전부 대기
            createReservationWithSuccessResponse(userInfo);
        } finally { doneLatch.countDown(); }
    });
}
latch.countDown(); // 모든 스레드를 동시에 풀어줌
```

서로 다른 랜덤 유저 10명이 **같은 좌석 번호**로 동시에 예약을 시도하도록 만든 뒤(`concert-reservation-concurrency.feature`), `Then` 절에서 **DB를 직접 조회**해서 정확히 1건만 생성됐는지 검증한다. "시작 래치 하나 + 완료 래치 하나"로 진짜 동시 발사를 보장하는 이 패턴은 그대로 가져다 써도 좋다.

다만 코드를 더 파보니 미묘한 흠이 하나 있었다: 각 스레드 안에서 부르는 `createReservationWithCreated`가 HTTP 201을 단정(assert)하는데, 이건 `executorService.submit()`으로 던진 `Runnable` 안에서 실행되고 `Future.get()`으로 결과를 받지 않는다. 그러니 9개 요청은 실제로 409류 실패가 나서 그 assert가 깨질 텐데, 그 예외가 스레드 안에서 조용히 사라진다. 다행히 최종 판정은 별도 repository 직접 조회 방식이라 테스트 자체 신뢰성엔 문제가 없지만, "개별 요청이 성공했다"를 검증하는 코드는 사실상 죽어있는 셈이다. **`ExecutorService.submit()` + 예외 무시 조합이 왜 위험한지**를 보여주는 실사례.

## Redis 분산 락 — `forceUnlock()`을 쓸 수밖에 없었던 이유

가장 흥미로웠던 부분. 결제 흐름엔 애노테이션 기반 분산 락이 걸려있다.

```java
@DistributedLock(prefix = "api-orchestration-payment",
    keys={"#request.userId", "#request.targetId", "#request.amount", "#request.paymentTarget"},
    timeUnit = MILLISECONDS, waitTime = 0, leaseTime = 500)
public PaymentResponse processPayment(PaymentProcessRequest request) { ... }
```

`DistributedLockAspect`가 `@Around`로 감싸서 `lock() → 메서드 실행 → finally에서 unlock()` 흐름을 만든다. **그런데 이 프로젝트는 Redis를 직접 안 쓰고, `redis-service`라는 전담 마이크로서비스를 REST(Feign)로 호출해서 락을 건다** — 이 구조가 뒤에 나오는 문제의 원인이다.

실제 Redisson 호출은 `redis-service`의 [RedisLockCoreRepository](redis-service/src/main/java/io/redisservice/api/infrastructure/repository/RedisLockCoreRepository.java) 안에 있다:

```java
public boolean lock(LockCommand lockCommand) {
    RLock lock = redissonClient.getLock(lockCommand.getLockKey());
    return lock.tryLock(lockCommand.getWaitTime(), lockCommand.getLeaseTime(), lockCommand.getTimeUnit());
}

/**
 * 배경: 일반적으로 Redis의 분산 락은 락을 획득한 스레드만이 해당 락을 해제할 수 있도록 설계되어 있습니다.
 * 그러나, 특정 요구사항에 따라 락을 보유하고 있지 않은 스레드도 락을 해제해야 할 필요가 있습니다.
 * 이를 위해 forceUnlock 메서드를 사용...
 */
public boolean unlock(UnLockCommand unLockCommand) {
    RLock lock = redissonClient.getLock(unLockCommand.getLockKey());
    lock.forceUnlock();  // 소유권 체크 없이 무조건 삭제
    return true;
}
```

이 코드 주석이 이유를 그대로 설명해준다. Redisson의 정상적인 `unlock()`은 "지금 부르는 게 락을 획득했던 바로 그 스레드인가"를 확인하는데, 여기선 락 획득(`lock()`)과 해제(`unlock()`)가 **각각 별개의 HTTP 요청**으로 `redis-service`에 들어온다. `redis-service` 입장에서 `lock()`을 처리했던 스레드는 이미 응답을 반환하고 사라졌고, `unlock()`은 완전히 새 스레드로 들어온다. Redisson의 소유권 체크는 "같은 스레드"를 기준으로 하기 때문에, 이 구조에서 정상 `unlock()`을 쓰면 **항상 "소유자가 아니다"로 실패**한다. 그래서 어쩔 수 없이 `forceUnlock()`(소유권 무시)으로 우회한 것 — 즉 이건 실수가 아니라 "락을 REST 뒤에 숨긴 아키텍처"가 강제한 선택이다.

### 근데 이 우회가 진짜 레이스를 다시 열어준다

`leaseTime=500ms`인데, 이 락이 감싸고 있는 임계 구역 안에서는 결제 서비스 Feign 호출 + 예약 확정 Feign 호출(각각 DB 쓰기 포함)이 순서대로 일어난다. `leaseTime`이 -1이 아니라 고정값(500)이라서 Redisson의 watchdog(자동 연장)도 작동하지 않는다.

```
[스레드 A] 락 획득 (500ms 유효)
    │
    │  작업이 500ms를 넘김 → 락 자연 만료
    │
[스레드 B] 같은 키로 락 획득 성공, 작업 시작
    │
[스레드 A] 뒤늦게 작업 끝냄 → finally에서 unlock() 호출
    │  → forceUnlock()이 B가 지금 쓰고 있는 락을 그냥 지워버림 (소유권 체크 없음)
    │
[스레드 C] B가 아직 작업 중인데 락을 잡을 수 있게 됨
```

"lease 만료 중간에 끊김"이라는 Redisson의 흔한 함정에, "소유권 미확인 강제 해제"가 겹쳐서 락이 있으나 마나 해지는 조합이다. `waitTime=0`으로 락 획득 실패는 즉시 감지하도록(fail-fast) 잘 짜놨는데, 정작 해제 쪽에서 구멍이 났다.

### 제대로 고치려면

- **락을 REST 뒤에 숨기지 않고, Redisson 클라이언트를 직접 붙인다** — 같은 JVM/스레드 컨텍스트가 유지되니 정상적인 owner-check `unlock()`이 가능해진다.
- **펜싱 토큰(fencing token)을 직접 구현한다** — `lock()` 응답으로 유니크한 토큰(UUID)을 돌려주고, `unlock()` 호출 시 그 토큰을 같이 보내서 "지금 저장된 락 값이 이 토큰과 같을 때만 삭제"하도록 만든다. Redis `SET key value NX` + `EVAL`로 원자적 비교삭제를 구현하는 게 Redlock 등 분산 락 구현체의 표준 해법.

지금 구조(락을 별도 REST 마이크로서비스 뒤에 둔 것)와 owner-check unlock은 애초에 같이 갈 수 없는 조합이라, "이 아키텍처를 선택하면 이런 트레이드오프가 따라온다"를 보여주는 좋은 사례다. `Mutex Lock` 노트에 정리한 [[Mutex Lock]] 기본 흐름(락 획득→임계구역→해제)과 비교해서 보면, "왜 분산 환경에서는 unlock 하나도 이렇게 까다로워지는지"가 더 잘 보인다.

## 발표용 토론 포인트

- 왜 좌석/잔액은 DB 락, 결제는 Redis 분산 락을 썼을까? → 임계 구역이 한 트랜잭션 안에 있는지, 여러 서비스에 걸쳐있는지로 기준을 나눠볼 수 있다.
- `leaseTime`을 고정값으로 주는 것과 `-1`(watchdog 자동 연장)로 주는 것의 차이는? 이 프로젝트라면 어느 쪽이 맞았을까?
- 분산 락을 별도 마이크로서비스(REST)로 감싸면 어떤 문제가 생기는지 — 이 프로젝트가 겪은 owner-check 불가 문제 말고 또 뭐가 있을지 (레이턴시, 부분 장애 시 락 상태 불일치 등).
- `ExecutorService.submit()`으로 던진 작업의 예외가 왜 조용히 사라지는지, `Future.get()`/`invokeAll()`을 쓰면 뭐가 달라지는지.

## 한 줄 정리
> 좌석·잔액은 단일 트랜잭션 안이라 DB 비관적 락으로 충분했고, 결제는 서비스 경계를 넘나들어서 Redis 분산 락이 필요했다 — 그런데 그 락을 REST 뒤에 숨긴 구조가 owner-check unlock을 원천적으로 막아서 `forceUnlock()`을 쓰게 됐고, 그게 다시 "lease 만료 중 레이스"를 열어준 게 이 프로젝트에서 가장 배울 게 많았던 지점이다.
