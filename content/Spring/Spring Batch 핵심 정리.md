---
date: 2026-09-29
lastmod: 2026-09-29
tags:
draft: false
---
# Spring Batch는 뭘 해결해주고, 어떻게 구성되는가

"배치 그냥 `@Scheduled`에 반복문 돌리면 되는 거 아니에요?"라는 질문에 답할 수 있어야 한다. 데이터가 많아지고 실패에 대응해야 하는 순간, 그걸 직접 다 챙기는 건 생각보다 어렵다.

## Spring Batch란?

**대량의 데이터를 일정 단위로 나눠서 안정적으로 처리하기 위한 Spring 기반 배치 처리 프레임워크.**

웹 API가 "요청이 오면 바로 처리하고 응답"하는 거라면, 배치는 "데이터를 모아뒀다가 정해진 시점에 한꺼번에 처리"하는 거다.

### 이럴 때 쓴다

- 일별/월별 매출 정산, 주문 데이터 집계
- 휴면 회원 처리, 회원 등급 일괄 갱신
- 만료 데이터 삭제, 대량 데이터 마이그레이션, CSV Import
- 통계 데이터 생성

## 반복문 + @Scheduled만으로는 왜 부족한가

100만 건을 처리하다가 중간에 죽었다고 해보자. 그러면 이런 걸 전부 직접 챙겨야 한다.

- 어디까지 처리했지?
- 처음부터 다시 돌려야 하나?
- 이미 성공한 데이터가 중복 처리되지 않나?
- 실패한 작업을 재시작할 수 있나?
- 100만 건을 메모리에 한 번에 올려도 되나?
- 성공/실패 상태는 어디에 남기지?

Spring Batch는 이걸 **대량 처리, 트랜잭션 관리, 실행 상태 관리, 실패/재시작 처리**로 프레임워크 차원에서 해결해준다.

## 핵심 구조

```
Job
 ├── Step 1
 │    ├── ItemReader
 │    ├── ItemProcessor
 │    └── ItemWriter
 │
 └── Step 2
```

- **Job**: 하나의 전체 배치 작업. 예) `DailySettlementJob`
- **Step**: Job을 구성하는 하나의 작업 단계
  ```
  DailySettlementJob
   ├── Step 1: 주문 정산
   └── Step 2: 정산 완료 처리
  ```
- **ItemReader**: 처리할 데이터를 읽는다. 예) DB에서 Order 조회
- **ItemProcessor**: 읽은 데이터를 가공하거나 비즈니스 로직을 수행한다. 예) Order → 정산 금액 계산. 필요 없으면 생략 가능
- **ItemWriter**: 처리 결과를 저장하거나 외부 시스템으로 보낸다. 예) 정산 결과 DB 저장

기본 흐름은 결국 이거다.

```
Reader → Processor → Writer
 읽기       처리        저장
```

## Chunk = 트랜잭션 경계

**Chunk는 대량 데이터를 일정 개수씩 묶어서 처리하는 단위**이고, Chunk 기반 처리에서는 **Chunk 하나가 트랜잭션 하나**다. chunk size가 1,000이면:

```
1 ~ 1,000       Reader → Processor → Writer → Commit
1,001 ~ 2,000   Reader → Processor → Writer → Commit
...반복
```

그래서 얻는 것:

- 메모리에는 항상 1,000건만 올라간다
- 트랜잭션 범위가 일정하게 제한된다
- 100만 건 전체를 하나의 거대한 트랜잭션으로 묶었다가 마지막에 터져서 전부 롤백되는 상황을 막는다. 실패해도 이미 커밋된 Chunk는 살아 있다

## 실행 상태 관리 — JobRepository

Spring Batch는 Job과 Step의 실행 정보를 **JobRepository**를 통해 메타데이터 테이블에 기록한다.

```
BATCH_JOB_INSTANCE
BATCH_JOB_EXECUTION
BATCH_STEP_EXECUTION
...
```

덕분에 이런 걸 알 수 있다.

- 어떤 Job이 실행됐는가?
- 성공했나, 실패했나?
- 어느 Step에서 실패했나?
- 몇 건을 읽고/썼나?
- 실패한 Job을 재시작할 수 있나?

앞에서 "직접 챙겨야 한다"던 질문들에 대한 답이 바로 이 메타데이터다.

## @Scheduled와 Spring Batch는 경쟁 관계가 아니다

둘은 역할이 다르다.

- `@Scheduled`: **언제** 실행할 것인가
- Spring Batch: 배치 작업을 **어떻게** 처리하고 관리할 것인가

```java
@Scheduled(cron = "0 0 2 * * *") // 매일 새벽 2시
public void run() throws Exception {
    jobLauncher.run(dailySettlementJob, jobParameters);
}
```

```
스케줄러 (@Scheduled / Kubernetes CronJob / Airflow ...)
   ↓
Spring Batch Job → Step → Reader → Processor → Writer → Chunk Commit
```

실무에서는 실행 시점을 `@Scheduled` 대신 Kubernetes CronJob이나 Airflow로 관리하는 경우도 많다.

## 핵심 용어 정리

| 개념 | 역할 |
|---|---|
| **Job** | 하나의 전체 배치 작업 |
| **Step** | Job을 구성하는 작업 단계 |
| **ItemReader** | 데이터 읽기 |
| **ItemProcessor** | 데이터 가공 및 비즈니스 로직 (생략 가능) |
| **ItemWriter** | 처리 결과 저장 |
| **Chunk** | 데이터를 일정 개수씩 묶어 처리하는 단위 = 트랜잭션 단위 |
| **JobRepository** | Job/Step 실행 상태와 메타데이터 관리 |
| **JobLauncher** | Job 실행을 시작 |

## 한 줄 정리
> Spring Batch는 대량 데이터를 Chunk 단위로 읽고, 처리하고, 저장하면서 실행 상태와 트랜잭션을 체계적으로 관리하는 프레임워크다. `@Scheduled`는 "언제", Spring Batch는 "어떻게"를 맡는다.

## 관련 노트
- [[Spring Batch 구성 요소]] — Job/Step/Reader/Processor/Writer/Chunk 각각의 동작
- [[Spring Batch 개념과 Chunk 처리]] — 마이그레이션 코드 예시, 메타데이터 테이블, 페이징 Reader 성능
