---
date: 2026-08-10
lastmod: 2026-08-10
tags:
draft: false
---
# @Transactional을 붙였는데 왜 트랜잭션이 안 걸릴까 — self-invocation 문제

Spring에서 `@Transactional`을 메서드에 붙이면 항상 트랜잭션이 걸릴 거라 생각하기 쉽지만,
**같은 빈 안에서 자기 자신의 메서드를 호출(self-invocation)하면 그 애노테이션이 조용히 무시됩니다.**

## 왜 이런 일이 생길까

Spring의 `@Transactional`은 코드 자체를 바꾸는 게 아니라, 빈을 감싸는 **프록시 객체**를 통해 동작합니다.

```
클라이언트 → [프록시] → 실제 빈.method()
              ↑
        여기서 트랜잭션 시작/커밋이 끼어듦
```

문제는, 빈 내부에서 `this.otherMethod()`처럼 자기 자신을 호출하면 이 흐름을 타지 않고
**프록시를 거치지 않은 채 실제 객체로 바로 들어간다는 것**입니다. 그래서 `otherMethod`에
`@Transactional`이 붙어 있어도 아무 효과가 없어요.

```java
@Service
public class OrderService {

    public void placeOrder() {
        save(); // self-call — 프록시를 거치지 않음
    }

    @Transactional // 위 호출 경로에서는 무시됨
    public void save() { ... }
}
```

## 해결 방법

트랜잭션이 필요한 로직을 **별도의 빈으로 분리**해서, 호출이 반드시 그 빈의 프록시를 거치도록 만듭니다.

```java
@Service
public class OrderService {

    private final OrderProcessor orderProcessor; // 주입받은 별도 빈

    public void placeOrder() {
        orderProcessor.save(); // 프록시를 거쳐 들어감 → 트랜잭션 정상 적용
    }
}

@Component
public class OrderProcessor {

    @Transactional
    public void save() { ... }
}
```

## 한 줄 정리

> `@Transactional`은 프록시 기반이라, **다른 빈을 거쳐 들어오는 호출에만** 적용된다.
> 같은 빈 안의 self-call에는 적용되지 않으므로, 트랜잭션이 필요한 로직은 별도 빈으로 분리해야 한다.
