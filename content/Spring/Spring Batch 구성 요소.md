---
date: 2026-09-29
lastmod: 2026-09-29
tags:
draft: false
---
# Spring Batch 구성 요소는 각각 무슨 일을 하는가

"Job, Step, Reader, Processor, Writer"를 이름만 외우면 면접에서 "Processor가 null을 반환하면요?", "Chunk는 정확히 어떤 순서로 도나요?" 같은 질문에서 막힌다. 각 구성 요소가 실제로 어떻게 움직이는지를 정리한다.

```
Job
 └── Step (여러 개 가능)
      └── Chunk 단위 반복
           ├── ItemReader    (1건씩 읽기)
           ├── ItemProcessor (1건씩 가공)
           └── ItemWriter    (Chunk 묶음으로 쓰기)
```

## Job — 배치 작업 전체

하나의 배치 작업 전체를 뜻한다. Job 자체는 일을 하지 않고, **어떤 Step을 어떤 순서로 실행할지 흐름만 정의**한다.

```java
@Bean
public Job dailySettlementJob(Step settleStep, Step completeStep) {
    return new JobBuilder("dailySettlementJob", jobRepository)
            .start(settleStep)
            .next(completeStep)
            .build();
}
```

Job은 실행될 때 세 가지로 나눠서 봐야 한다.

- **Job**: 설계도. `dailySettlementJob`
- **JobInstance**: Job + JobParameters 조합. "2026-09-29자 정산"처럼 논리적인 실행 한 건
- **JobExecution**: JobInstance를 실제로 실행한 시도 한 번. 실패 후 재시작하면 같은 JobInstance에 JobExecution이 하나 더 생긴다

```
dailySettlementJob (Job)
 ├── date=2026-09-28 (JobInstance) ── Execution #1 COMPLETED
 └── date=2026-09-29 (JobInstance) ── Execution #1 FAILED
                                    └── Execution #2 COMPLETED (재시작)
```

그래서 **이미 COMPLETED된 JobInstance를 같은 파라미터로 다시 실행하면 거부된다** (`JobInstanceAlreadyCompleteException`). 같은 날짜 정산을 두 번 돌리는 사고를 프레임워크가 막아주는 셈이다.

## Step — 실제 일을 하는 단계

Job을 구성하는 작업 단계이고, 실제 처리 로직은 전부 Step 안에 있다. Step 구현 방식은 두 가지다.

| 방식 | 언제 | 예 |
|---|---|---|
| **Chunk 기반** | 대량 데이터를 읽고-가공하고-쓰는 반복 작업 | 주문 100만 건 정산 |
| **Tasklet 기반** | 한 번 실행하고 끝나는 단순 작업 | 임시 테이블 비우기, 파일 삭제 |

```java
// Tasklet: execute()를 한 번 실행하고 끝
@Bean
public Step cleanupStep() {
    return new StepBuilder("cleanupStep", jobRepository)
            .tasklet((contribution, chunkContext) -> {
                tempRepository.deleteAll();
                return RepeatStatus.FINISHED;
            }, transactionManager)
            .build();
}
```

Step도 실행될 때마다 **StepExecution**이 생기고, 여기에 읽은 건수(readCount), 쓴 건수(writeCount), 건너뛴 건수(skipCount), 커밋 횟수(commitCount)가 기록된다.

## ItemReader — 1건씩 읽는다

```java
public interface ItemReader<T> {
    T read() throws Exception; // 더 읽을 게 없으면 null
}
```

- `read()`는 **한 번에 1건**을 반환한다
- **null을 반환하면 "데이터 끝"** 으로 보고 Step이 종료된다

대표 구현체:

| 구현체 | 방식 |
|---|---|
| `JdbcCursorItemReader` | DB 커서를 열어두고 스트리밍으로 읽음 |
| `JdbcPagingItemReader` | sortKey 기반 keyset 페이징 |
| `JpaPagingItemReader` | JPQL + OFFSET 페이징 |
| `FlatFileItemReader` | CSV 같은 파일을 한 줄씩 읽음 |

## ItemProcessor — 1건씩 가공한다 (생략 가능)

```java
public interface ItemProcessor<I, O> {
    O process(I item) throws Exception;
}
```

- 읽은 데이터 1건을 받아서 가공하거나 비즈니스 로직을 수행한다
- **입력 타입과 출력 타입이 달라도 된다** (`Order` → `Settlement`)
- **null을 반환하면 그 아이템은 필터링되어 Writer로 넘어가지 않는다** — 조건에 안 맞는 데이터를 걸러낼 때 쓴다

```java
@Bean
public ItemProcessor<Order, Settlement> processor() {
    return order -> {
        if (order.isCanceled()) {
            return null; // 취소 주문은 정산 대상에서 제외
        }
        return Settlement.of(order);
    };
}
```

가공이 필요 없으면 Processor를 아예 빼면 된다.

## ItemWriter — Chunk 묶음으로 한 번에 쓴다

```java
public interface ItemWriter<T> {
    void write(Chunk<? extends T> chunk) throws Exception; // Spring Batch 4까지는 List
}
```

Reader와 Processor는 1건씩 다루지만, **Writer만 Chunk 단위 묶음을 한 번에 받는다.** 그래서 벌크 INSERT처럼 한 번의 DB 호출로 여러 건을 쓸 수 있다.

대표 구현체: `JdbcBatchItemWriter`(JDBC 배치 INSERT/UPDATE), `JpaItemWriter`, `FlatFileItemWriter`

## Chunk — 이 전부를 묶는 처리/트랜잭션 단위

Chunk는 일정 개수의 아이템을 묶은 단위이고, **Chunk 하나 = 트랜잭션 하나**다. chunk size가 3이라면 한 Chunk 안에서 실제로는 이렇게 돈다.

```
[트랜잭션 시작]
 read() → A
 read() → B
 read() → C           ← chunk size만큼 읽을 때까지 1건씩 반복
 process(A) → A'
 process(B) → null    ← 필터링됨
 process(C) → C'
 write([A', C'])      ← 모인 것을 한 번에 쓰기
[커밋] → StepExecution 갱신
...read()가 null을 반환할 때까지 반복
```

핵심 포인트:

- **읽기/가공은 1건씩, 쓰기는 묶음으로**
- Chunk 도중 예외가 나면 **그 Chunk만 롤백**되고, 이전에 커밋된 Chunk는 그대로 남는다
- 재시작하면 JobRepository에 기록된 마지막 커밋 지점부터 이어서 처리한다
- chunk size는 트레이드오프다. 너무 작으면 커밋이 잦아 느리고, 너무 크면 메모리 사용량과 롤백 범위가 커진다

## 한 줄 정리
> Job은 Step의 실행 흐름을 정의하는 설계도이고, Step 안에서 Reader가 1건씩 읽고 Processor가 1건씩 가공(null이면 필터링)해 chunk size만큼 모이면 Writer가 한 번에 쓰고 커밋한다 — 이 Chunk가 곧 트랜잭션 단위다.

## 관련 노트
- [[Spring Batch 핵심 정리]] — Spring Batch를 왜 쓰는지, @Scheduled와의 차이
- [[Spring Batch 개념과 Chunk 처리]] — 마이그레이션 코드 예시, 메타데이터 테이블, 페이징 Reader 성능
