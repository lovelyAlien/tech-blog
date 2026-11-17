---
date: 2026-10-16
lastmod: 2026-10-16
tags:
draft: false
---
# ThreadPoolExecutor는 작업을 어떤 순서로 받는가

스레드 풀 설정값(corePoolSize, maxPoolSize, queueCapacity)은 이름만 보면 직관적이지만, **어떤 순서로 적용되는지** 모르면 "max가 10인데 왜 스레드가 6개만 돌지?"나 "왜 작업이 거절되지?" 같은 상황을 설명하지 못한다. Spring Batch Partitioning의 gridSize 튜닝을 이해하는 데도 필요하다.

## 설정값 세 가지

| 설정 | 뜻 |
|---|---|
| `corePoolSize` | 평소에 유지하는 스레드 수 |
| `queueCapacity` | 스레드가 모두 바쁠 때 작업을 쌓아 두는 **대기 의자** 수 |
| `maxPoolSize` | 대기 의자까지 꽉 찼을 때 늘릴 수 있는 최대 스레드 수 |

## 판단 순서: core → 대기열 → max → 거절

새 작업이 들어오면 아래 순서로 판단한다.

```
① 일하는 스레드 수 < core?       → 새 스레드를 만들어 바로 실행
② 아니면 대기열에 자리가 있나?    → 대기열에서 기다림
③ 대기열이 꽉 찼으면 스레드 < max? → 스레드를 추가해 실행
④ 그것도 꽉 찼으면               → ❌ 거절 (Spring에서는 TaskRejectedException)
```

**max는 대기열이 꽉 차야 비로소 쓰인다**는 점이 핵심이다. 대기열이 무제한이면 max는 영원히 쓰이지 않는다.

## 비유: 은행 창구

```
창구(스레드) 6개, 번호표(작업) 31장

처음:    창구 1~6이 1~6번 처리 중, 7~31번은 대기석에서 기다림
잠시 후: 창구 3이 먼저 끝남 → 대기석 맨 앞의 7번을 부름
...      31장이 다 처리될 때까지 반복
```

작업을 창구에 미리 나눠 주지 않는다. **먼저 끝난 창구가 다음 번호를 부른다.** 작업마다 걸리는 시간이 달라도 일이 고르게 나뉜다. Spring Batch Partitioning에서 날짜별 파티션을 스레드에 나눠 줄 때도 이렇게 돈다. 날마다 데이터 양이 다르기 때문에(주말 50만 건, 월말 500만 건) 미리 5일씩 묶어 배정하면 어떤 스레드는 일찍 놀고 어떤 스레드는 한참 걸린다.

## queueCapacity에 따라 결과가 달라진다

core 6, max 10에 작업 31개를 한꺼번에 넣는 경우다.

| | `queueCapacity = 0` | `queueCapacity` 미설정 |
|---|---|---|
| 1~6번째 | 스레드 6개로 실행 | 스레드 6개로 실행 |
| 7~10번째 | 대기 의자가 없음 → 스레드를 10개까지 늘려 실행 | 대기열에서 기다림 |
| 11~31번째 | **❌ 거절** | 대기열에서 차례대로 실행 ✅ |

Spring의 `ThreadPoolTaskExecutor`는 `queueCapacity`를 설정하지 않으면 기본값이 `Integer.MAX_VALUE`, 사실상 무제한이다. 이때는 스레드가 core 수만큼만 돌고 max는 쓰이지 않는다.

```java
@Bean
public TaskExecutor batchTaskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(6);      // gridSize와 맞춤
    executor.setMaxPoolSize(10);
    // executor.setQueueCapacity(0);  // 작업 수 > max면 거절될 수 있음
    executor.setThreadNamePrefix("batch-thread-");
    executor.initialize();
    return executor;
}
```

카카오페이 사례의 튜닝 표는 queueCapacity를 0으로 권한다. 근거는 "Partitioning은 시작할 때 작업을 한꺼번에 할당하니 대기열이 필요 없다"이다. 이 말은 **파티션 수가 스레드 수보다 적거나 같을 때만** 맞다. 날짜별로 31개 파티션을 만드는 같은 글의 예시와는 맞지 않는다(내 해석).

## gridSize 시작값 (사례의 가이드)

- 시작값은 CPU 코어 × 1.5 (4코어면 6). DB 조회와 가공 위주 작업 기준이다.
- CPU 사용률이 50% 이하인데 느리면 1.5배로 늘린다.
- 메모리 부족 에러가 나면 절반으로 줄인다. 병렬 수만큼 메모리 사용량이 곱해지기 때문이다.
- DB 커넥션이 부족하면 줄이거나 커넥션 풀을 늘린다.

## 내가 헷갈렸던 것

| 처음 이해 | 정확한 이해 |
|---|---|
| 스레드 6개에 31개 작업을 5일씩 미리 배정한다 | 미리 배정하지 않는다. **끝난 스레드가 다음 것을 가져간다** |
| queueCapacity가 0이면 작업이 안 버려진다 | 반대다. 대기 의자가 없으니 max까지 차면 **거절된다** |

## 스스로 확인할 질문

- core 6, max 10, queue 0에 작업 31개를 넣으면 어떻게 되는가?
- queue를 설정하지 않으면 왜 max가 쓰이지 않는가?
- 작업을 미리 나눠 주지 않고 먼저 끝난 스레드가 가져가게 하면 무엇이 좋은가?

## 확인 필요

- Spring Batch `TaskExecutorPartitionHandler`가 queueCapacity 0인 풀에 max보다 많은 파티션을 넣을 때 실제로 거절이 일어나는지 테스트로 확인할 것

## 한 줄 정리

> 스레드 풀은 core → 대기열 → max → 거절 순으로 작업을 받는다. max는 대기열이 꽉 차야 쓰이고, 대기열이 0이면 max를 넘는 작업은 거절된다.

## 관련 노트

- [[경쟁 상태와 thread-safe]]
- [[Spring Batch Partitioning 면접 설명과 성능 결과 해석]]
