---
date: 2026-08-24
lastmod: 2026-08-24
tags:
draft: false
---
# 비동기 작업이 배포 중에 유실되는 이유 — Graceful Shutdown과 SIGTERM vs SIGKILL

[[29CM 아웃박스 패턴 리팩터링 사례 - BEFORE_COMMIT과 AFTER_COMMIT]]에서 카프카 전송을 담당하는 `@Async` 리스너가 배포 중에 실행되지 못하고 outbox 상태값이 `init`으로 남는 문제를 분석하다가 정리한 내용. `@TransactionalEventListener` 자체의 동작 원리는 [[ApplicationEventPublisher와 TransactionalEventListener]] 참고.

## outbox 상태값이 `init`으로 남는 경우 — `@Async`와 graceful shutdown

outbox 테이블의 상태 흐름을 시간 순서로 보면 이렇다.

```
[도메인 트랜잭션 commit] → 이 시점에 outbox row는 이미 'init' 상태로 DB에 존재
        │
        ▼
[AFTER_COMMIT 트리거] → @Async 이므로, 실제 실행을 스레드풀에 "제출"만 하고 리턴
        │
        ▼ (스레드풀의 워커 스레드가 언젠가 이 작업을 집어감)
[리스너 메서드 body 실행 시작]
        │
        ├─ 카프카 전송 성공 → UPDATE ... SET status = 'send_success'
        └─ 카프카 전송 실패(네트워크/클러스터 이슈) → catch에서 UPDATE ... SET status = 'send_fail'
```

`send_success`/`send_fail`은 **둘 다 리스너 메서드 body가 실제로 실행돼서, 그 안의 UPDATE 쿼리가 돌았을 때만** 나오는 결과다.

카프카 전송 리스너는 `@Async(EVENT_ASYNC_TASK_EXECUTOR)`가 붙어 있어서, `AFTER_COMMIT`이 트리거되는 순간 바로 카프카를 호출하는 게 아니라 "이 작업을 별도 스레드풀 큐에 넣어달라"고 요청만 하고 바로 리턴한다. 즉 commit과 "실제 리스너 코드 실행" 사이에 시간 간격이 생긴다.

그 간격 사이에 서비스 배포로 pod가 종료되면서 스레드풀 자체가 강제로 죽어버리면, 큐에 있던 그 작업은 **한 줄도 실행되지 못한 채 통째로 사라진다**. 카프카 전송 시도도 안 하고, 그 안의 `try/catch`도 안 돌고, 상태를 `send_fail`로 바꾸는 UPDATE 문도 실행되지 않는다. 그래서 outbox row는 도메인 트랜잭션이 커밋될 때 처음 INSERT된 그 상태, 즉 `init` 그대로 남는다 — 카프카에 보내다가 실패한 게 아니라, **카프카를 시도조차 안 해본 것**이다.

| 상태 | 의미 | 원인 |
|---|---|---|
| `send_fail` | 리스너가 실행됐고, 그 안에서 카프카 호출을 시도했지만 실패함 | 카프카 클러스터/네트워크 장애 |
| `init`(오래 남음) | 리스너 자체가 실행되지 못함 — 카프카 호출 시도 자체가 없었음 | `@Async` 작업 제출 후, 실제 실행 전에 프로세스가 죽음(배포 등) |

둘 다 결과적으로 카프카에 안 갔다는 점은 같지만, `send_fail`은 "리스너 코드가 실행됐다"는 증거(UPDATE 쿼리 실행)가 남는 반면 `init`으로 남는 경우는 그 증거 자체가 없다 — 애초에 리스너 메서드 안으로 진입도 못 한 것이다.

이 문제의 근본 원인은 graceful shutdown 미흡이다. `ThreadPoolTaskExecutor`가 종료될 때 진행 중이거나 대기 중인 작업을 기다려주지 않고 즉시 죽어버리기 때문인데, 아래 두 옵션을 명시적으로 설정해야 이를 방지할 수 있다.

```java
executor.setWaitForTasksToCompleteOnShutdown(true);
executor.setAwaitTerminationSeconds(10);
```

**`setWaitForTasksToCompleteOnShutdown(true)`**: `ThreadPoolTaskExecutor`의 기본 종료 방식은 `shutdownNow()`에 가까운 즉시 종료다. 이 옵션을 켜면 "새로운 작업은 더 이상 받지 않지만, 이미 큐에 들어가 있거나 실행 중인 작업은 끝까지 처리하고 나서 종료해라"로 바뀐다(`ExecutorService.shutdown()` 방식). 실행 중인 스레드를 인터럽트하지 않고, 큐에 남은 작업도 계속 꺼내서 처리한다.

**`setAwaitTerminationSeconds(10)`**: 위 옵션만으로는 부족하다 — "작업들을 처리하도록 지시"만 할 뿐, 그 처리가 끝날 때까지 종료 절차 자체를 기다려주지는 않기 때문이다. 이 값을 지정해야, 스프링이 `executor.destroy()`를 호출할 때 내부적으로 `ExecutorService.awaitTermination(10, TimeUnit.SECONDS)`를 호출해서 최대 10초 동안 블로킹하며 남은 작업이 실제로 끝나기를 기다린다. 이 값이 없으면 `shutdown()` 호출 직후 바로 리턴해버리고, `ApplicationContext.close()`도 곧장 끝나버려서 작업이 다 끝났는지 확인도 안 한 채로 JVM 종료 절차가 이어진다.

| 설정 | 역할 | 이것만 있을 때 문제 |
|---|---|---|
| `setWaitForTasksToCompleteOnShutdown(true)` | 종료 시 큐에 남은 작업을 계속 처리하도록 지시 | 처리할 시간을 안 주면 무의미 — JVM이 먼저 죽어버릴 수 있음 |
| `setAwaitTerminationSeconds(N)` | 그 처리가 끝날 때까지 최대 N초간 종료 절차를 블로킹 | 이것만 있고 위 설정이 `false`면 애초에 남은 작업을 처리하려고도 안 함 |

즉 첫 번째 옵션이 "떠나기 전에 하던 일을 마저 끝내라"는 지시라면, 두 번째 옵션은 "그 일이 끝날 때까지 문 앞에서 실제로 기다려주겠다"는 보장이다. 두 개가 같이 있어야 "큐에 있던 카프카 전송 작업이 pod 종료 전에 실제로 완료된다"는 게 보장되고, 하나라도 빠지면 rolling 배포 시 큐에 남은 작업이 유실될 여지가 남는다.

이 설정이 빠지면, 서비스 배포처럼 정상적인 상황에서도 pod가 rolling될 때마다 큐에 남아있던 카프카 전송 작업이 통째로 유실되고, outbox 테이블에는 오랫동안 `init` 상태로 남는 이벤트가 배포 직후마다 쌓이게 된다.

## 왜 하필 "배포 직후"에만 몰려서 발생하는가

평상시(배포 없이 계속 돌고 있는 상태)엔 프로세스가 강제로 죽을 일이 없다. `@Async` 스레드풀에 작업이 쌓여도 시간이 걸릴 뿐, 프로세스가 살아있는 한 워커 스레드가 결국 큐에 있는 작업을 순서대로 다 처리한다. 이 흐름이 강제로 끊기는 유일한 순간이 **pod가 종료될 때**이고, 그게 일어나는 대표적인 상황이 배포(rolling update)다. 그래서 "오래 `init` 상태로 남은 이벤트 = 전부 배포 직후에 생겼다"는 관찰이 나온다 — 애초에 이 문제가 발생할 수 있는 유일한 트리거가 배포이기 때문이다.

쿠버네티스 rolling update는 대략 이런 순서로 진행된다.

```
1. 새 버전 pod 생성
2. 새 pod의 readiness probe 통과 → 트래픽이 새 pod로 전환 시작
3. 기존 pod에 SIGTERM 전송 (이제 종료해달라는 신호)
4. terminationGracePeriodSeconds(기본 30초) 동안 대기 — 이 안에 프로세스가 알아서 종료되길 기다림
5. 그래도 안 죽어있으면 SIGKILL로 강제 종료
```

3번의 SIGTERM을 스프링 부트가 받으면 JVM 종료 훅이 동작해서 `ApplicationContext.close()`가 호출되고, 그 안에서 각 빈의 종료 로직(`DisposableBean.destroy()`)이 실행된다. `ThreadPoolTaskExecutor`도 빈이라 이 시점에 자신의 `destroy()`가 호출된다.

`destroy()`는 `setWaitForTasksToCompleteOnShutdown(true)`가 켜져 있으면 "새 작업은 안 받지만, 큐에 있는 작업은 다 처리하고 종료해라"라고 지시한다(`ExecutorService.shutdown()`). 문제는 이게 저절로 기다려주지 않는다는 것 — `awaitTerminationSeconds`를 명시적으로 지정해야 "그 작업들이 실제로 다 끝날 때까지 최대 N초간 블로킹하며 기다린다"는 동작이 추가된다.

이 값이 없으면 `destroy()`는 `shutdown()`만 호출하고 기다리지 않고 바로 리턴한다. 그러면 `ApplicationContext.close()`도 곧바로 끝나버리고, JVM 프로세스 자체가 그대로 종료 절차를 마쳐버린다. 이 시점에 카프카 전송 큐에 아직 안 돌아간 작업이 남아있었다면, 프로세스가 끝나버리는 순간 그 작업도 실행 중이었든 큐에서 대기 중이었든 상관없이 함께 통째로 사라진다.

정리하면: 배포로 인한 pod 재기동(rolling)이 프로세스를 강제 종료시키는 유일한 상황이고, 그 종료 시점에 `awaitTerminationSeconds` 설정이 없어서 큐에 남은 카프카 전송 작업을 기다려주지 않았기 때문에, "배포 직후"라는 시점에 정확히 몰려서 `init` 상태 유실이 발생한다.

## graceful shutdown은 "비정상 종료"에는 애초에 무력하다

여기서 짚어야 할 한계가 있다 — 지금까지의 graceful shutdown은 전부 **`SIGTERM`을 받았을 때만** 동작하는 메커니즘이다. `SIGTERM`은 JVM에게 "정리할 시간을 줄게"라고 알려주는 신호라서, shutdown hook이 실행되고 그 안에서 `ApplicationContext.close()` → 각 빈의 `destroy()` → `ThreadPoolTaskExecutor.awaitTermination()`까지 코드가 실행될 기회를 얻는다.

반면 `SIGKILL`(`kill -9`), 커널 OOM killer, 호스트 자체가 죽는 상황(하드웨어 장애, 노드 크래시, 전원 문제) 같은 **비정상 종료**는 운영체제가 프로세스를 그 자리에서 즉시 강제 종료시켜버린다. 이 경우 JVM은 shutdown hook을 실행할 기회 자체를 얻지 못한다 — `destroy()` 메서드 한 줄도 실행되지 않고 프로세스가 사라진다.

| 종료 방식 | shutdown hook 실행됨? | graceful shutdown 설정이 도움되나 |
|---|---|---|
| `SIGTERM` (정상 배포, `kubectl delete pod`, rolling update) | ✅ 실행됨 | ✅ 도움됨 |
| `SIGKILL` (grace period 초과 후 강제 종료) | ❌ 실행 안 됨 | ❌ 무의미 |
| OOM killer, 노드 크래시, 전원 장애 | ❌ 실행 안 됨 | ❌ 무의미 |

즉 `setWaitForTasksToCompleteOnShutdown`/`setAwaitTerminationSeconds`는 "배포처럼 예측 가능하고 협조적인 종료" 상황의 유실만 막아줄 뿐, 진짜 비정상 종료 앞에서는 무력하다.

## 그래서 outbox 패턴의 재시도 배치가 진짜 안전망이다

이 지점이 outbox 패턴 전체 설계에서 graceful shutdown 설정이 갖는 위치를 정확히 보여준다. graceful shutdown은 **"이 문제가 발생하는 빈도를 줄여주는 최적화"**일 뿐이고, 원인이 무엇이든(설정 누락이든, 정상 배포든, `SIGKILL`이든, 노드가 통째로 죽든) 이벤트가 카프카로 못 나간 채 `init`/`send_fail`로 남을 가능성 자체는 절대 0으로 만들 수 없다.

그래서 이 아키텍처의 최종 안전망은 항상 **outbox 테이블을 주기적으로 스캔하는 배치(재시도 폴러)**다. 그 배치 입장에서는 "왜 이 이벤트가 아직 발행되지 않았는지" 이유를 전혀 몰라도 상관없다 — graceful shutdown 실패든, 진짜 서버가 죽었든, `created_at`이 오래됐는데 아직 `send_success`가 아닌 row는 다 다시 시도 대상이 된다. 이게 바로 "eventually consistency"(결국 언젠가는 모든 서비스 간의 데이터 정합성이 맞춰진다)라는 표현이 가리키는 것이다.

즉 graceful shutdown 설정은 재시도 배치가 처리해야 할 유실 건수를 줄여주는 개선이지, 그 자체로 유실을 원천 차단하는 해결책은 아니다 — 원천 차단은 애초에 불가능하고, 그래서 outbox 패턴에 재시도 메커니즘이 필수로 딸려 있다.

## 한 줄 정리

> `@Async`로 실행되는 후속 작업은 커밋과 실행 사이에 시간 간격이 생기고, 그 간격에 프로세스가 죽으면(특히 배포 중 SIGTERM 처리 미흡) 작업이 흔적도 없이 유실된다. graceful shutdown 설정은 이 유실 빈도를 줄여줄 뿐 SIGKILL 같은 비정상 종료 앞에서는 무력하므로, 결국 주기적으로 미완료 상태를 스캔해 재시도하는 배치가 있어야 진짜 안전망이 된다.
