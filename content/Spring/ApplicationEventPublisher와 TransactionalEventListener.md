---
date: 2026-08-24
lastmod: 2026-08-24
tags:
draft: false
---
# ApplicationEventPublisher와 @TransactionalEventListener

29CM의 [트랜잭셔널 아웃박스 패턴 실제 구현 사례](https://medium.com/@greg.shiny82/%ED%8A%B8%EB%9E%9C%EC%9E%AD%EC%85%94%EB%84%90-%EC%95%84%EC%9B%83%EB%B0%95%EC%8A%A4-%ED%8C%A8%ED%84%B4%EC%9D%98-%EC%8B%A4%EC%A0%9C-%EA%B5%AC%ED%98%84-%EC%82%AC%EB%A1%80-29cm-0f822fc23edb) 글을 읽다가 정리한 내용. 관련: [[아웃박스 패턴 심화 - 재시도, 순서 보장, Dual Write 문제]], [[아웃박스 테이블 스키마]]. 이 개념을 29CM이 실제로 어떻게 적용했는지는 [[29CM 아웃박스 패턴 리팩터링 사례 - BEFORE_COMMIT과 AFTER_COMMIT]], 배포 중 카프카 전송이 유실되는 문제는 [[Graceful Shutdown과 SIGTERM vs SIGKILL]] 참고.

## `ApplicationEventPublisher` — 스프링 내부 이벤트 발행기

`ApplicationEventPublisher`는 카프카 같은 외부 브로커가 아니라, **같은 애플리케이션 프로세스 안에서만** 이벤트를 발행/구독하게 해주는 스프링 컨테이너 기능이다. `ApplicationContext`가 이 인터페이스를 구현하고 있어서, 빈에 주입받아 `publishEvent(event)`를 호출하면 스프링이 그 이벤트 타입을 리스닝하는 `@EventListener`/`@TransactionalEventListener` 메서드들을 찾아 실행해준다.

**여기서 가장 헷갈리기 쉬운 포인트**: `publishEvent()` 호출 자체는 카프카와 전혀 무관하다. 직렬화도, 브로커로의 네트워크 전송도, 토픽 이름도 이 시점엔 등장하지 않는다. 자바의 옵저버 패턴이나 JS의 `EventEmitter.emit()`처럼, 같은 메모리 공간 안에서 리스너를 호출해주는 것뿐이다. 실제로 카프카에 보내는 일은 이 이벤트를 구독하는 **리스너 메서드 내부**에서 `kafkaProducer.send(...)`를 호출할 때 비로소 일어난다.

이걸 쓰는 근본적인 이유는 "도메인 로직"과 "그 이후에 처리되어야 할 로직"을 분리하기 위해서다. 도메인 메서드는 "이런 일이 있었다"고 인메모리로 신호만 쏘고 끝나고, 그 신호를 받아서 실제로 외부 시스템(카프카, outbox 기록 등)에 반영하는 일은 전적으로 리스너 쪽 책임으로 넘어간다. 도메인 메서드는 카프카나 outbox 테이블의 존재 자체를 몰라도 된다.

## `@TransactionalEventListener` — 트랜잭션 생명주기에 묶여 실행되는 리스너

일반 `@EventListener`는 `publishEvent()` 호출 즉시 동기 실행되지만, `@TransactionalEventListener`는 실행 시점을 현재 트랜잭션의 특정 단계(`TransactionPhase`)로 미룬다.

- `BEFORE_COMMIT`: 커밋되기 직전, 트랜잭션이 아직 열려 있는 상태
- `AFTER_COMMIT`(기본값): 커밋이 실제로 성공한 직후
- `AFTER_ROLLBACK`: 롤백된 경우
- `AFTER_COMPLETION`: 커밋/롤백 상관없이 트랜잭션 종료 시

### 왜 `AFTER_COMMIT`은 커밋 성공 이후에만 동작하는가

`publishEvent()`가 호출된 시점에 현재 스레드에 활성 트랜잭션이 있으면, 스프링은 리스너를 즉시 실행하는 대신 `TransactionSynchronization` 콜백으로 등록만 해둔다(`TransactionSynchronizationManager.registerSynchronization(...)`). 도메인 메서드가 정상 반환되어 트랜잭션 매니저가 실제 DB `commit()`을 성공시키면, `triggerAfterCommit()`이 호출되어 그제서야 등록해둔 콜백(리스너)이 실행된다.

반대로 트랜잭션 중간에 예외가 나서 롤백되면 `triggerAfterCompletion(STATUS_ROLLED_BACK)`이 호출되고, `AFTER_COMMIT` 콜백은 아예 트리거되지 않는다 — 즉 리스너 자체가 호출되지 않고 버려진다. 그래서 "도메인 로직이 온전히 성공했을 때만 이벤트가 발행되는 것"이 보장된다. 리스너 실행 여부가 애플리케이션 코드의 조건문이 아니라 **DB commit의 성공/실패라는 트랜잭션 매니저의 최종 판정에 그대로 묶여 있기 때문**이다.

참고로 `TransactionSynchronizationManager`는 스레드 로컬 기반이라, `publishEvent()` 호출 시점에 활성 트랜잭션이 없으면 등록할 콜백 자체가 없다. 기본 설정(`fallbackExecution=false`)에서는 이 경우 이벤트가 조용히 유실된다 — `@Transactional` 메서드 안에서 호출하는 게 전제 조건이다.

### `BEFORE_COMMIT`의 내부 동작 — 실제 DB commit보다 먼저 실행된다

`AFTER_COMMIT`과 뿌리는 같은 메커니즘(`TransactionSynchronizationManager`에 콜백 등록)이지만, 콜백이 트리거되는 시점이 실제 DB commit보다 **먼저**라는 게 핵심 차이다.

`@Transactional` 메서드가 정상 반환되면, 트랜잭션 매니저(`AbstractPlatformTransactionManager`)는 내부적으로 이런 순서로 동작한다.

```
1. triggerBeforeCommit()   ← 등록된 콜백 중 BEFORE_COMMIT 리스너 실행
2. triggerBeforeCompletion()
3. doCommit()              ← 실제 DB에 COMMIT 전송 (예: connection.commit())
4. triggerAfterCommit()    ← doCommit() 성공했을 때만, AFTER_COMMIT 리스너 실행
5. triggerAfterCompletion()
```

즉 `BEFORE_COMMIT` 리스너는 **아직 실제 `COMMIT`이 DB에 전송되기 전**, 트랜잭션이 열려 있는 시점에 같은 스레드에서 실행된다.

**왜 outbox 기록이 원래 트랜잭션에 합류되는가**: `TransactionSynchronizationManager`는 현재 스레드에 바인딩된 DB 커넥션(또는 JPA 영속성 컨텍스트)을 스레드 로컬로 들고 있다. `BEFORE_COMMIT` 리스너가 이 시점에 outbox 테이블에 INSERT를 하면, 새 트랜잭션을 여는 게 아니라 **같은 스레드에 이미 바인딩되어 있는 그 커넥션을 그대로 재사용**한다. 그래서 이 INSERT는 도메인 로직이 만든 변경 사항과 물리적으로 같은 트랜잭션에 속하게 되고, 잠시 후 3번 단계(`doCommit()`)에서 둘 다 한 번의 `COMMIT`으로 함께 확정된다.

**`AFTER_COMMIT`과의 결정적 차이 — 실패 시 결과가 다르다**: 이 순서 때문에 두 phase는 리스너가 실패했을 때 결과가 완전히 다르다.

- `BEFORE_COMMIT`에서 예외 발생: 아직 `doCommit()` 전이라, 이 예외가 커밋 프로세스를 중단시키고 **트랜잭션 전체가 롤백**된다. 도메인 로직 변경사항도, outbox 기록도 전부 없던 일이 된다.
- `AFTER_COMMIT`에서 예외 발생(예: 카프카 전송 실패): 이미 3번 단계에서 `COMMIT`이 끝난 뒤라, 도메인 로직과 outbox 기록은 이미 DB에 확정된 상태다. 카프카 전송만 실패한 채로 남고, 이건 별도의 재시도 폴러가 outbox 테이블을 보고 나중에 복구한다.

29CM 설계에서 outbox 기록을 `BEFORE_COMMIT` 리스너로 옮긴 게 안전한 이유가 여기 있다 — outbox 기록이 실패하면(예: DB 제약조건 위반) 도메인 로직까지 통째로 롤백되는 게 오히려 **의도된 동작**이다. "도메인 로직은 성공했는데 outbox 기록만 빠진" 상태가 나오는 것보다, 둘 다 롤백되는 편이 데이터 정합성 관점에서 안전하기 때문이다.

## 리스너가 이벤트를 매칭하는 원리 — 파라미터 타입으로 연결된다

"발행된 이벤트를 어떤 리스너가 받을지"는 이벤트 이름표나 별도의 등록 키가 아니라, **리스너 메서드 파라미터의 타입 하나**로 결정된다.

- 시작 시점: `EventListenerMethodProcessor`가 모든 빈을 훑어 `@EventListener`/`@TransactionalEventListener`가 붙은 메서드를 찾고, 각 메서드를 `ApplicationListenerMethodAdapter`(트랜잭셔널이면 `ApplicationListenerMethodTransactionalAdapter`)로 감싸 등록해둔다. 이때 메서드의 파라미터 타입을 리플렉션으로 기억해둔다.
- 발행 시점: `publishEvent(event)`가 호출되면 `ApplicationEventMulticaster`가 등록된 리스너들을 순회하며 `supportsEventType(...)`으로 "발행된 객체의 런타임 타입이 이 리스너의 파라미터 타입에 대입 가능한가"만 검사한다. 매칭되는 리스너만 호출된다.

`phase`는 "언제 호출할지"만 정할 뿐, "어떤 이벤트를 받을지"의 매칭 조건에는 관여하지 않는다 — 그래서 같은 이벤트 타입을 파라미터로 받는 `BEFORE_COMMIT` 리스너와 `AFTER_COMMIT` 리스너가 동시에 존재할 수 있다.

### 예시

```java
public class ReservationConfirmedEvent {
    private final Long reservationId;
    private final String roomName;
}
```

```java
@Transactional
public void confirmReservation(Long reservationId) {
    Reservation reservation = reservationRepository.findById(reservationId);
    reservation.confirm();

    // "ReservationConfirmedEvent 타입의 객체"를 발행
    eventPublisher.publishEvent(new ReservationConfirmedEvent(reservationId, reservation.getRoomName()));
}
```

```java
@Component
public class ReservationOutboxRecorder {
    // 파라미터 타입이 ReservationConfirmedEvent → 매칭됨
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void recordOutbox(ReservationConfirmedEvent event) { ... }
}

@Component
public class ReservationKafkaPublisher {
    // 이것도 파라미터 타입이 똑같이 ReservationConfirmedEvent → 매칭됨
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void sendToKafka(ReservationConfirmedEvent event) { ... }
}

@Component
public class RoomAvailabilityUpdater {
    // 파라미터 타입이 다름(RoomAvailabilityChangedEvent) → 이 이벤트를 발행해도 절대 호출 안 됨
    @EventListener
    public void updateAvailability(RoomAvailabilityChangedEvent event) { ... }
}
```

`publishEvent(new ReservationConfirmedEvent(...))`가 호출되면 파라미터 타입이 `ReservationConfirmedEvent`(또는 그 상위 타입)인 리스너만 호출 대상이 된다. `RoomAvailabilityChangedEvent`를 받는 리스너는 타입이 다르므로 아예 호출되지 않는다.

### 함정 — Command와 Event 타입이 슬쩍 다를 수 있다

29CM 원문의 도메인 메서드를 보면 이런 코드가 나온다.

```java
@Transactional
public InventoryQuantityUpdateInfo updateInventoryQuantity(XxxxCommand command) {
    XxxxResult updateResult = updateInventoryQuantity(command);

    // 여기서 넘기는 건 InventoryEventCommand
    inventoryEventService.eventPublish(InventoryEventCommand.from(updateResult));

    return InventoryQuantityUpdateInfo.of(updateResult);
}
```

```java
@TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
public void recordMessageHandler(InventoryExternalEvent event) { ... }  // 여기서 받는 건 InventoryExternalEvent
```

얼핏 보면 발행 타입(`InventoryEventCommand`)과 리스너가 받는 타입(`InventoryExternalEvent`)이 달라서 매칭이 안 될 것처럼 보인다. 실제로는 `inventoryEventService.eventPublish(...)`가 스프링의 `ApplicationEventPublisher.publishEvent()`가 아니라 **커스텀 서비스의 자체 메서드**이고, 그 내부에서 `InventoryEventCommand`를 `InventoryExternalEvent`로 변환한 뒤에야 진짜 `publishEvent()`를 호출하는 구조로 추정된다.

```java
@Service
@RequiredArgsConstructor
public class InventoryEventService {
    private final ApplicationEventPublisher applicationEventPublisher;

    public void eventPublish(InventoryEventCommand command) {
        InventoryExternalEvent event = InventoryExternalEvent.from(command);  // Command → Event 변환
        applicationEventPublisher.publishEvent(event);  // 실제 타입 매칭은 여기서 InventoryExternalEvent로 확정
    }
}
```

- **Command**: "이걸 해달라"는 요청/의도를 담는 객체 — 도메인 메서드가 서비스에게 넘기는 입력값
- **Event**: 실제로 스프링 이벤트 시스템에 발행되는, "이런 일이 일어났다"는 사실을 표현하는 객체

이렇게 Command와 Event를 나누면 도메인 메서드가 "발행될 이벤트의 정확한 스키마"까지 알 필요 없이 서비스에게 위임할 수 있다는 장점이 있다. 다만 함정도 있다 — 만약 `eventPublish()` 내부가 `InventoryEventCommand`를 변환 없이 그대로 `publishEvent()`에 넘긴다면, `InventoryExternalEvent`를 구독하는 리스너는 **타입이 달라서 절대 호출되지 않는** 실제 버그가 된다. Command와 Event 타입이 최종적으로 일치하는지는 리팩터링/코드 리뷰에서 놓치기 쉬운 포인트다.

## 한 줄 정리

> `ApplicationEventPublisher.publishEvent()`는 카프카와 무관한 순수 인메모리 신호이고, 실제 외부 발행은 그걸 구독하는 리스너 안에서 일어난다. `@TransactionalEventListener`는 그 리스너 실행을 트랜잭션의 특정 단계(주로 커밋 직전/직후)로 미뤄서, 도메인 로직의 성공 여부에 이벤트 발행 여부를 정확히 묶어낸다.
