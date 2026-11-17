---
date: 2026-10-16
lastmod: 2026-10-16
tags:
draft: false
---
# Spring Batch Partitioning은 어떤 구조로 데이터를 나눠 처리하는가

Partitioner, PartitionHandler, TaskExecutor, Worker Step… 부품 이름은 많은데 서로 어떻게 연결되는지 그림이 안 그려지면 사례 글이 안 읽힌다. 카카오페이 정산플랫폼팀 사례(3월 한 달 치 원장을 하루 단위로 나눠 병렬 처리)를 기준으로 구조와 흐름을 한 장씩 따라가 본다.

## 전체 구조 — 누가 누구 안에 있나

![[Spring Batch Partitioning 흐름-00-전체구조.svg]]

위에서 아래로 갈수록 실제 일에 가까워진다. 세 층으로 나눠 보면 된다.

| 층 | 부품 | 하는 일 | 데이터를 만지나? |
|---|---|---|---|
| **계획** | Manager Step, Partitioner, PartitionHandler | 나누고, 나눠 주고, 기다림 | ❌ 날짜 표지만 다룸 |
| **일꾼** | TaskExecutor의 스레드 6개 | 표지를 하나씩 받아 Worker Step 실행 | ❌ 실행만 함 |
| **실제 처리** | Worker Step 안의 Reader → Processor → Writer | DB에서 읽고, 가공하고, 씀 | ✅ **여기서만** |

### 비유: 시험지 채점

| 비유 | 용어 | 하는 일 |
|---|---|---|
| 담임 선생님 | **Manager Step** | 전체 총괄. 반장에게 계획을 받아 관리자에게 넘기고 최종 결과를 보고 |
| 반장 | **Partitioner** | **무엇을** 나눌지 — 조각 목록과 표지만 만듦 (계획) |
| 관리자 | **PartitionHandler** | **어떻게** 실행할지 — 조교 몇 명, 누구에게, 끝날 때까지 대기 (실행) |
| 시험지 한 묶음 | **Partition** | 데이터의 한 조각. 여기서는 하루치 |
| 묶음의 표지 | **ExecutionContext** | "너는 3월 5일" 같은 작업 명세서 |
| 조교 6명 | **스레드 풀 (TaskExecutor)** | 실제로 일하는 일꾼 |
| 조교의 채점 | **Worker Step** | 한 조각을 Reader → Processor → Writer로 처리 |

> 반장(Partitioner)은 총괄 매니저가 아니다. 총괄은 Manager Step이고, 반장과 관리자는 Manager Step이 부리는 부하다. 그리고 `taskExecutor`, `gridSize`, `step` 같은 **설정은 관리자(PartitionHandler) 쪽**에 한다.

## 두 개의 흐름을 구분하자

이 구조에는 흐름이 두 개 있다. 이걸 섞으면 헷갈린다.

- **표지가 흐르는 길**: jobParameters → Partitioner → PartitionHandler → 스레드 → Worker Step의 Reader
- **데이터가 흐르는 길**: MongoDB 원장 → Reader → Processor → Writer → 통계 컬렉션

위의 계획·일꾼 층에는 데이터가 아니라 **"3/5"라는 글자(표지)** 만 흘러 내려온다. 원장 데이터를 실제로 31개로 쪼개는 단계는 **없다**. 나누는 건 **조회 조건(날짜)** 뿐이고, 걸러내는 건 DB가 한다.

## 단계별 흐름

### 1. 배치 실행 — 기간을 넣어 Job을 시작

![[Spring Batch Partitioning 흐름-01-배치실행.svg]]

사람이나 스케줄러가 `startDate=2025-03-01`, `endDate=2025-03-31`을 jobParameters로 넣고 Job을 실행한다. Job은 Manager Step부터 시작한다.

```bash
java -jar batch.jar --job.name=generateStatisticsJob startDate=2025-03-01 endDate=2025-03-31
```

### 2. Partitioner — 표지 31장 만들기

![[Spring Batch Partitioning 흐름-02-Partitioner.svg]]

Manager Step이 Partitioner를 부른다. Partitioner는 **날짜만 계산해서** 표지(ExecutionContext) 31장을 만든다. 원장 데이터는 한 건도 읽지 않는다.

```kotlin
@Bean @JobScope
fun partitioner(
    @Value("#{jobParameters['startDate']}") startDate: String,
    @Value("#{jobParameters['endDate']}") endDate: String,
): Partitioner = DateRangePartitioner(LocalDate.parse(startDate), LocalDate.parse(endDate))

class DateRangePartitioner(val start: LocalDate, val end: LocalDate) : Partitioner {
    override fun partition(gridSize: Int): Map<String, ExecutionContext> {
        val days = ChronoUnit.DAYS.between(start, end.plusDays(1))
        return (0 until days).associate { i ->
            "partition_$i" to ExecutionContext().apply {
                putString("targetDate", start.plusDays(i).toString())
            }
        }
    }
}
// partition_4 → { targetDate: "2025-03-05" }
```

`gridSize`를 인자로 받지만 날짜 기준으로 나누므로 여기서는 쓰지 않는다. 파티션 개수는 날짜 수로 정해진다.

### 3. PartitionHandler — 표지를 스레드 6개에 배분

![[Spring Batch Partitioning 흐름-03-PartitionHandler.svg]]

PartitionHandler가 표지를 TaskExecutor(스레드 풀)에 넘긴다. 스레드가 6개라 3/1 ~ 3/6이 먼저 시작되고 나머지는 대기한다.

```kotlin
@Bean
fun managerStep(partitionHandler: PartitionHandler, partitioner: Partitioner): Step =
    StepBuilder("managerStep", jobRepository)
        .partitioner("dailyPartition", partitioner)  // 어떻게 쪼갤지 → 반장
        .partitionHandler(partitionHandler)          // 어떻게 실행할지 → 관리자
        .build()

@Bean
fun partitionHandler(workerStep: Step): PartitionHandler =
    TaskExecutorPartitionHandler().apply {
        setTaskExecutor(batchTaskExecutor())  // 조교 명단 (스레드 풀)
        step = workerStep                     // 조교가 할 일
        gridSize = GRID_SIZE
    }
```

| 구성 요소 | 내가 할 일 |
|---|---|
| Partitioner | ✍️ **직접 구현** — 나누는 기준은 업무마다 다르다 |
| PartitionHandler | ⚙️ `TaskExecutorPartitionHandler`에 설정만 |
| TaskExecutor | ⚙️ `ThreadPoolTaskExecutor`에 설정만 |
| Manager / Worker Step | ⚙️ `StepBuilder`로 조립만 |

### 4. 스레드 5가 표지 3/5로 Worker Step 실행

![[Spring Batch Partitioning 흐름-04-WorkerStep실행.svg]]

스레드 하나가 표지 하나를 들고 Worker Step을 실행한다. 이때 `@StepScope` 덕분에 **이 실행 전용 Reader가 새로 만들어지고**, 표지의 `targetDate`(3/5)를 주입받는다.

| 무엇 | 개수 | 비유 |
|---|---|---|
| Worker Step **정의** (`workerStep` Bean) | 1개 | 채점 매뉴얼 1권 |
| Worker Step **실행** (StepExecution) | 31개 | 채점 작업 31건 |
| 스레드 | 6개 | 조교 6명 |
| Reader 인스턴스 (`@StepScope`) | 31번 생성, 동시에 최대 6개 | 채점할 때마다 새로 받는 채점표 |

**`@StepScope`가 없으면?** Reader가 싱글톤 하나로 만들어져 6개 스레드가 같이 쓰게 된다. Reader 안의 "어디까지 읽었나" 위치 값을 여러 스레드가 동시에 고치면 **경쟁 상태(race condition)** 가 생겨 같은 데이터를 두 번 읽거나 건너뛴다. 게다가 앱 시작 시점에는 아직 표지가 없어서 `stepExecutionContext` 값을 주입할 수도 없다.

### 5. Reader — DB에서 3/5 데이터만 1,000건씩

![[Spring Batch Partitioning 흐름-05-Reader.svg]]

Reader가 `date = 3/5` 조건으로 커서를 열어 1,000건씩 받아 온다.

```kotlin
@Bean @StepScope
fun reader(
    @Value("#{stepExecutionContext['targetDate']}") targetDate: String,  // ← 표지에서 꺼냄
): MongoCursorItemReader<PaymentLedger> =
    MongoCursorItemReaderBuilder<PaymentLedger>()
        .name("reader")
        .template(mongoTemplate)
        .targetType(PaymentLedger::class.java)
        .query(Query(Criteria.where("date").`is`(targetDate)))           // ← "3월 5일 것만"
        .sorts(mapOf("orderNumber" to Sort.Direction.ASC))
        .batchSize(1000)
        .build()
```

> 원문 Reader 코드는 `stepExecutionContext['startDate']`, `['endDate']`를 읽어서 Partitioner의 `targetDate`와 키가 맞지 않는다. 위 코드는 키를 `targetDate`로 맞춘 버전이다.

**왜 Cursor인가?**

| Reader 방식 | 메모리 | 속도 |
|---|---|---|
| 하루치를 한 번에 전부 조회 | ❌ 300만 건 × 스레드 6개가 한 힙에 → **OOM** | — |
| Paging (`skip` + `limit`) | ✅ 1,000건 | ❌ 매번 처음부터 세서 뒤로 갈수록 느려짐 |
| Cursor | ✅ 1,000건 | ✅ DB 서버가 읽은 위치를 기억해서 비용 일정 |

- **chunkSize는 Reader 안쪽을 제한하지 않는다.** Reader가 내부에서 전부 조회하면 Chunk가 1,000건씩 돌아도 뒤에서 수백만 건이 메모리를 차지한다.
- **커서 번호 ≠ 읽은 위치.** 애플리케이션은 번호표(커서 ID)만 들고, 읽은 위치는 **DB 서버**가 기억한다. 그래서 다 쓰면 반드시 닫아야 한다.

### 6. Processor → Writer — 1,000건을 한 번에 쓰기

![[Spring Batch Partitioning 흐름-06-Processor-Writer.svg]]

```
read × 1000번 → process × 1000번 → write(1000건 목록) 1번 → 커밋 → 다시 read…
```

Writer는 Bulk Operations로 1,000건을 **한 번의 요청**으로 저장한다. Writer **호출** 횟수와 DB **요청** 횟수는 다르다 — 원문 설명대로 문서마다 save하는 방식이면 Writer 1번 호출에 요청이 1,000번 나간다.

### 7. 먼저 끝난 스레드가 다음 표지를 가져감

![[Spring Batch Partitioning 흐름-07-다음표지.svg]]

미리 "스레드마다 5일씩" 배정하지 않는다. **은행 창구 방식**이다. 스레드 1이 3/1을 먼저 끝내면 대기 중인 3/7을 가져가 4~6단계를 반복한다. 날마다 데이터 양이 다르기 때문에, 끝난 스레드가 다음 것을 가져가야 일이 고르게 나뉜다.

> ⚠️ 대기하려면 스레드 풀에 **대기열**이 있어야 한다. 원문 튜닝 표는 `queueCapacity = 0`을 권하는데, 제 이해로는 이 경우 스레드가 `maxPoolSize`까지 다 차면 남은 파티션은 **거절**될 수 있다. 파티션이 스레드보다 많을 때는 테스트로 확인 필요.
>
> 스레드 풀이 작업을 받는 순서: core 미만이면 새 스레드 → 대기열에 자리가 있으면 대기 → 대기열이 차면 max까지 스레드 추가 → 그것도 차면 거절

### 8. 결과 취합 — Manager Step 종료

![[Spring Batch Partitioning 흐름-08-결과취합.svg]]

31개 Worker Step이 모두 끝나면 PartitionHandler가 결과를 모아 Manager Step에 돌려준다. Manager Step이 최종 상태를 정하고 Job이 끝난다.

## 헷갈렸던 것 정리

| 처음 이해 | 실제 |
|---|---|
| chunkSize = 1,000이면 메모리에 1,000건만 있다 | Reader가 내부에서 전부 조회하면 수백만 건이 남는다 |
| 누군가 원장 데이터를 31개로 쪼갠다 | 아무도 쪼개지 않는다. 조회 조건만 나누고 DB가 걸러 준다 |
| Partitioner가 총괄 매니저다 | 총괄은 Manager Step. Partitioner는 계획, PartitionHandler는 실행 |
| 스레드마다 5일씩 미리 배정한다 | 끝난 스레드가 다음 파티션을 가져간다 |
| Paging은 뒤로 갈수록 메모리를 많이 쓴다 | 메모리는 같고 **느려지는** 것 |
| 파티션 31개면 Worker도 31개 | 실행은 31개, 정의는 1개, 동시에 도는 건 스레드 수(6개)만큼 |

## 한 줄 정리
> Partitioner가 날짜 표지를 만들고, PartitionHandler가 그 표지를 스레드에 배분하면, 각 Worker Step의 Reader가 자기 표지의 날짜로 DB를 조회한다 — 위로는 표지만, 아래로는 데이터가 흐른다.

## 관련 노트
- [[Spring Batch 핵심 정리]] — Spring Batch를 왜 쓰는지, @Scheduled와의 차이
- [[Spring Batch 구성 요소]] — Job, Step, Reader, Processor, Writer, Chunk 각각의 역할
- [[Spring Batch 개념과 Chunk 처리]] — 메타데이터 테이블, 페이징 Reader 성능
- 원문: [카카오페이 기술 블로그 — Spring Batch Partitioning](https://tech.kakaopay.com/post/spring-batch-partitioning/)
