---
date: 2026-10-16
lastmod: 2026-10-16
tags:
draft: false
---
# @JobScope와 @StepScope는 왜 필요한가

Spring Batch Partitioning 코드에는 `@JobScope`, `@StepScope`, `#{stepExecutionContext['targetDate']}` 같은 게 붙어 있다. 이게 없으면 Reader가 "나는 3월 5일 데이터를 읽어야 한다"는 걸 알 방법이 없고, 스레드끼리 Reader를 공유하는 문제도 생긴다.

## 기본 Bean은 싱글톤이다

일반 Spring Bean은 **앱이 시작할 때 딱 하나** 만들어져서 모두가 같이 쓴다. 배치에서는 이게 두 가지 문제를 만든다.

1. **값을 넣을 수 없다**: 앱이 시작하는 시점에는 아직 배치가 실행되지 않았으니 jobParameters(기간)도, 파티션별 날짜도 없다.
2. **공유된다**: Reader가 싱글톤이면 스레드 6개가 Reader 하나를 같이 쓰게 되고, "어디까지 읽었나" 상태가 꼬인다([[경쟁 상태와 thread-safe]]).

## Scope를 바꾸면 달라지는 것

| | 싱글톤 (기본) | `@JobScope` | `@StepScope` |
|---|---|---|---|
| 언제 만들어지나 | 앱 시작 시 1번 | **Job이 실행될 때** | **Step이 실행될 때마다** |
| 몇 개 | 1개를 모두 공유 | Job 실행마다 1개 | Step 실행마다 1개 (파티션 31개면 31번 생성) |
| 읽을 수 있는 값 | 없음 | `jobParameters` | `jobParameters`, `stepExecutionContext` |

이렇게 **실행 시점까지 Bean 생성을 미루고, 그때 생긴 값을 꽂아 넣는 것**을 지연 바인딩(late binding)이라고 한다. 둘 다 Spring Batch가 제공하는 어노테이션이다.

> 비유: 싱글톤은 교실 벽에 붙은 채점표 한 장을 조교 6명이 같이 쓰는 것이다. `@StepScope`는 조교가 시험지 묶음을 받을 때마다 그 반 이름이 적힌 새 채점표를 받는 것이다.

## 값이 Reader까지 오는 경로

```
① 배치 실행
   java -jar batch.jar startDate=2025-03-01 endDate=2025-03-31
        │ jobParameters
        ▼
② Partitioner (@JobScope)
   기간을 받아 날짜별 표지 31장 생성
   partition_4 → { targetDate: "2025-03-05" }
        │ ExecutionContext
        ▼
③ PartitionHandler
   표지를 스레드에 하나씩 넘기며 Worker Step 실행
        │ stepExecutionContext
        ▼
④ Reader (@StepScope)
   표지의 targetDate로 조회 조건을 만듦 → date = "2025-03-05"
```

```java
@Bean
@JobScope
public Partitioner partitioner(
        @Value("#{jobParameters['startDate']}") String startDate,     // ① 에서 옴
        @Value("#{jobParameters['endDate']}") String endDate) {
    return new DateRangePartitioner(LocalDate.parse(startDate), LocalDate.parse(endDate));
    // 내부에서 context.putString("targetDate", "2025-03-05") 같은 표지를 만든다
}

@Bean
@StepScope
public MongoCursorItemReader<PaymentLedger> reader(
        @Value("#{stepExecutionContext['targetDate']}") String targetDate) {   // ② 가 만든 표지
    return new MongoCursorItemReaderBuilder<PaymentLedger>()
            .name("reader")
            .template(mongoTemplate)
            .targetType(PaymentLedger.class)
            .query(new Query(Criteria.where("date").is(targetDate)))           // "3월 5일 것만"
            .sorts(Map.of("orderNumber", Sort.Direction.ASC))
            .batchSize(1000)
            .build();
}
```

`#{...}`는 "실행할 때 이 값을 꽂아 줘"라는 표시(SpEL)다. Scope 어노테이션 없이 쓰면 앱 시작 시점에 값을 찾다가 실패한다.

## 데이터를 쪼개는 사람은 없다

Partitioner는 원장 데이터를 한 건도 읽지 않는다. 날짜 글자 31개만 만든다. Reader도 31개로 나누지 않고 **자기 날짜 하나만** 조건을 걸어 조회한다. 걸러내는 건 DB가 한다. "31개로 나눈다"는 결과는 Reader 31개가 각자 다른 조건으로 조회한 것이 모여서 생긴다.

> 도서관 비유: 반장은 책을 옮기지 않고 "너는 3월 5일 서가에 가"라는 쪽지만 쓴다. 조교는 쪽지를 들고 그 서가에서 그 책만 꺼내 온다. 책은 처음부터 날짜별 서가에 꽂혀 있었다.

## 정의, 실행, 스레드, Reader는 개수가 다르다

| 무엇 | 개수 | 비유 |
|---|---|---|
| Worker Step **정의** (`workerStep` Bean) | 1개 | 채점 매뉴얼 1권 |
| Worker Step **실행** (StepExecution) | 31개 | 채점 작업 31건 |
| 스레드 | 6개 | 조교 6명 |
| Reader 인스턴스 (`@StepScope`) | 31번 생성, 동시에 살아 있는 건 최대 6개 | 작업마다 새로 받는 채점표 |

## 주의: 키 이름은 넣는 쪽과 꺼내는 쪽이 같아야 한다

카카오페이 원문 코드는 Partitioner가 `targetDate`를 넣는데, Reader 예시는 `stepExecutionContext['startDate']`, `['endDate']`를 꺼낸다. 서로 다른 예시를 합쳐 보여 준 것으로 보인다. 그대로 쓰면 Reader가 값을 받지 못한다. 위 코드는 키 이름을 `targetDate`로 맞춘 버전이다.

## 내가 헷갈렸던 것

| 처음 이해 | 정확한 이해 |
|---|---|
| 누군가 원장 데이터를 31개로 쪼갠다 | 아무도 쪼개지 않는다. **조회 조건(날짜)만** 나눈다 |
| 파티션 31개면 Worker도 31개 | 정의는 1개, 실행은 31개, 스레드는 6개 |
| 스레드별 하루치를 가져오는 것도 관리자(PartitionHandler)가 설정한다 | "하루치" 기준은 **Partitioner**, "누가 동시에 몇 명"은 **PartitionHandler**, "실제로 가져오기"는 **Reader** |

## 스스로 확인할 질문

- Reader를 싱글톤으로 두면 생기는 문제 두 가지는?
- "3월 5일"이라는 값은 어디서 시작해서 어떤 경로로 Reader까지 오는가?
- `@JobScope`와 `@StepScope`는 각각 언제 만들어지고 무엇을 읽을 수 있는가?

## 한 줄 정리

> `@StepScope`는 Step이 실행될 때마다 Bean을 새로 만들어, 실행 시점의 값(파티션별 날짜)을 넣어 주고 스레드끼리 Reader를 공유하지 않게 한다. 값은 jobParameters → Partitioner → ExecutionContext → Reader 순서로 전달된다.

## 관련 노트

- [[Spring Batch Partitioning 구조와 처리 흐름]]
- [[Spring Batch 구성 요소]]
- [[경쟁 상태와 thread-safe]]
- [[Paging과 Cursor 조회는 무엇이 다른가]]
