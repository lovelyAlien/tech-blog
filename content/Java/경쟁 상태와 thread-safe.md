---
date: 2026-10-16
lastmod: 2026-10-16
tags:
draft: false
---
# 경쟁 상태는 왜 생기고, thread-safe는 무슨 뜻인가

Spring Batch Partitioning에서 "Worker Step마다 Reader를 따로 둔다"는 설계를 이해하려면, 여러 스레드가 같은 값을 건드리면 무슨 일이 생기는지부터 알아야 한다. 면접에서도 "`count++`는 왜 thread-safe하지 않나요?"는 단골 질문이다.

## 스레드는 힙을 공유한다

한 JVM 안의 스레드들은 **힙(객체가 사는 곳)을 함께 쓴다.** 각자 따로 갖는 건 스택(지역 변수, 호출 정보)뿐이다.

| | 스레드마다 따로 | 모든 스레드가 공유 |
|---|---|---|
| 영역 | 스택 (지역 변수, 메서드 호출) | 힙 (객체, 객체의 필드) |
| 결과 | 서로 간섭하지 않는다 | **같은 객체를 동시에 고칠 수 있다** |

그래서 객체 하나를 여러 스레드가 같이 쓰면, 그 객체의 필드가 동시에 바뀔 수 있다.

## `count++`는 한 동작이 아니다

`count = count + 1`은 한 줄이지만 실제로는 세 단계로 실행된다.

```
1. count 값을 읽는다
2. 1을 더한다
3. 결과를 count에 저장한다
```

스레드 A와 B가 이 세 단계를 동시에 실행하면 이런 일이 생긴다.

| 시점 | 스레드 A | 스레드 B | count |
|---|---|---|---|
| 1 | count 읽음 → 5 | | 5 |
| 2 | | count 읽음 → 5 | 5 |
| 3 | 5 + 1 = 6 저장 | | 6 |
| 4 | | 5 + 1 = 6 저장 | **6** ❗ |

둘이 1씩 더했으니 7이어야 하는데 6이다. B가 A의 결과를 덮어써서 **+1 하나가 사라졌다.** 이렇게 여러 스레드가 같은 값을 동시에 고치다가 결과가 틀어지는 것을 **경쟁 상태(race condition)** 라고 한다.

```java
// Before: 경쟁 상태 — 결과가 2000보다 작게 나올 수 있다
class Counter {
    int count = 0;
    void increment() { count++; }
}

Counter c = new Counter();
Runnable task = () -> { for (int i = 0; i < 1000; i++) c.increment(); };
Thread a = new Thread(task), b = new Thread(task);
a.start(); b.start(); a.join(); b.join();
System.out.println(c.count);   // 2000이 아닐 수 있음
```

```java
// After: 원자적 연산 — 읽기·더하기·저장을 끼어들 수 없는 한 동작으로
class Counter {
    AtomicInteger count = new AtomicInteger();
    void increment() { count.incrementAndGet(); }
}
```

**thread-safe**란 여러 스레드가 동시에 써도 결과가 틀어지지 않는다는 뜻이다.

## 해결 방법은 세 갈래

| 방법 | 예 | 대가 |
|---|---|---|
| 잠그기 | `synchronized`, `ReentrantLock` | 한 번에 한 스레드만 → **기다림(병목)** |
| 원자적 연산 | `AtomicInteger`, `ConcurrentHashMap` | 단순한 연산에만 쓸 수 있음 |
| **공유하지 않기** | 스레드마다 자기 객체를 갖게 함 | 객체가 여러 개 생김 |

## Spring Batch에 대입하면

Reader 안에는 **"지금 몇 번째까지 읽었나"** 라는 상태(현재 위치, 현재 페이지 번호 등)가 있다. 위의 `count`와 같은 것이다. 스레드 6개가 Reader 하나를 같이 쓰면 두 가지 경우가 생긴다.

- **잠금이 없으면**: 위치 값이 꼬여서 같은 데이터를 두 번 처리하거나, 어떤 데이터는 건너뛴다.
- **잠금이 있으면**: 데이터는 안전하지만 스레드들이 줄을 서서 Reader가 병목이 된다. Spring Batch의 Multi-threaded Step 한계("Reader·Writer는 싱글 스레드라 I/O에 묶인다")가 이 경우다.

Partitioning은 세 번째 방법인 **공유하지 않기**를 쓴다. Worker Step마다 Reader를 따로 만들어서(`@StepScope`), 각자 자기 위치 값을 갖게 한다. 공유할 상태 자체가 없으니 잠금도 대기도 필요 없다.

## 싱글톤 Bean에 상태를 두면 안 되는 이유

Spring Bean은 기본이 **싱글톤**이다. 앱 전체에 하나만 만들어져서 모든 요청과 스레드가 같이 쓴다. 그래서 싱글톤 Bean의 필드에 요청별 상태를 저장하면 위의 `Counter`와 똑같은 문제가 생긴다.

```java
@Service
class BadService {
    private String currentUser;          // ❌ 모든 요청이 공유하는 필드

    void handle(String user) {
        this.currentUser = user;         // 다른 요청이 중간에 덮어쓸 수 있다
        ...
    }
}
```

상태는 지역 변수나 파라미터로 넘기고, 꼭 필요하면 Bean 스코프를 바꾼다(Spring Batch의 `@StepScope`가 그 예다).

## 내가 헷갈렸던 것

| 처음 이해 | 정확한 이해 |
|---|---|
| 스레드들이 Reader 하나를 쓰면 한 명이 점유하고 나머지가 기다리는 게 문제다 | 그건 **잠금이 있을 때**의 이야기(병목)다. 잠금이 없으면 상태가 꼬여서 **결과가 틀린다**(경쟁 상태) |
| `count`는 Spring Batch에 있는 변수 이름이다 | 설명용 이름이다. 실제 Reader에서는 "현재 위치", "현재 페이지" 같은 상태 값이다 |

## 스스로 확인할 질문

- 스레드끼리 공유하는 메모리 영역과 따로 갖는 영역은?
- `count++`가 thread-safe하지 않은 이유와 해결 방법 세 가지는?
- 잠금을 걸면 안전한데, 왜 Partitioning은 잠금 대신 Reader를 여러 개 만드는가?
- 싱글톤 Bean에 필드로 상태를 두면 어떤 문제가 생기는가?

## 한 줄 정리

> 스레드들은 힙을 공유하기 때문에, 같은 값을 동시에 고치면 중간 단계가 끼어들어 결과가 틀어진다(경쟁 상태). 해결은 잠그기, 원자적 연산, 공유하지 않기 세 가지이고, Spring Batch Partitioning은 Worker마다 Reader를 따로 줘서 공유 자체를 없앤다.

## 관련 노트

- [[Mutex Lock]]
- [[좌석 예약 동시성 제어 5가지 비교]]
- [[Spring Batch JobScope와 StepScope]]
- [[ThreadPoolExecutor 작업 처리 순서]]
