---
date: 2026-08-12
lastmod: 2026-08-12
tags:
draft: false
---
# Spring Batch가 뭐고 왜 쓰는가

수십만 건 단위의 대용량 데이터를 안정적으로 일괄 처리해야 할 때 쓰는 스프링 프레임워크. 단순 반복문으로 처리하면 메모리 초과(OOM), 중간 실패 시 처음부터 재처리, 트랜잭션/재시도 로직을 전부 직접 만들어야 하는 문제가 있는데, Spring Batch는 이걸 프레임워크 차원에서 해결해준다.

## 핵심 개념 3가지

- **Job**: 배치 작업 전체 단위 (예: "레거시 데이터 마이그레이션")
- **Step**: Job을 구성하는 하나의 단계. Job 안에 여러 Step이 순서대로 있을 수 있다
- **Chunk**: 데이터를 한 번에 다 처리하지 않고, 일정 개수씩 묶어서(chunk 단위로) 읽고-처리하고-쓰는 걸 반복하는 방식

```
[Reader] N건 읽기 → [Processor] 가공 → [Writer] N건 벌크 저장
       │ 이 사이클을 전체 데이터가 끝날 때까지 반복 (매번 N건만 메모리에 올림)
```

## Chunk 처리의 3요소

- `ItemReader`: 데이터를 읽어옴 (예: DB에서 500건씩 페이지 단위로)
- `ItemProcessor`: 읽어온 데이터를 가공 (선택적 단계)
- `ItemWriter`: 가공한 데이터를 씀 (예: 500건을 한 번에 벌크 INSERT)

## 코드 예시 (레거시 데이터 마이그레이션)

```java
@Configuration
@RequiredArgsConstructor
public class LegacyDataMigrationJobConfig {

    private final JobRepository jobRepository;
    private final PlatformTransactionManager transactionManager;
    private final DataSource legacyDataSource; // 레거시 DB
    private final DataSource newDataSource;    // 신규 DB

    // Job: 배치 작업 전체 단위
    @Bean
    public Job legacyDataMigrationJob(Step migrationStep) {
        return new JobBuilder("legacyDataMigrationJob", jobRepository)
                .start(migrationStep)
                .build();
    }

    // Step: chunk(500, ...) → 500건씩 읽고-처리하고-쓰는 걸 반복
    @Bean
    public Step migrationStep(ItemReader<LegacyDocument> reader,
                               ItemProcessor<LegacyDocument, NewDocument> processor,
                               ItemWriter<NewDocument> writer) {
        return new StepBuilder("migrationStep", jobRepository)
                .<LegacyDocument, NewDocument>chunk(500, transactionManager)
                .reader(reader)
                .processor(processor)
                .writer(writer)
                .faultTolerant()
                .skipLimit(10)                          // 10건까지는 실패해도 건너뛰고 계속 진행
                .skip(DataAccessException.class)
                .build();
    }

    // Reader: 레거시 DB에서 500건씩 페이지 단위로 읽음 (전체를 메모리에 안 올림)
    @Bean
    public JdbcPagingItemReader<LegacyDocument> reader() {
        return new JdbcPagingItemReaderBuilder<LegacyDocument>()
                .name("legacyDocumentReader")
                .dataSource(legacyDataSource)
                .selectClause("SELECT id, title, content, created_at")
                .fromClause("FROM documents")
                .sortKeys(Map.of("id", Order.ASCENDING))
                .pageSize(500)
                .rowMapper(new LegacyDocumentRowMapper())
                .build();
    }

    // Processor: 레거시 포맷 → 신규 포맷 변환 (없어도 되는 선택적 단계)
    @Bean
    public ItemProcessor<LegacyDocument, NewDocument> processor() {
        return legacy -> NewDocument.builder()
                .id(legacy.getId())
                .title(legacy.getTitle())
                .content(legacy.getContent())
                .migratedAt(LocalDateTime.now())
                .build();
    }

    // Writer: 변환된 500건을 한 번의 벌크 INSERT로 신규 DB에 적재
    @Bean
    public JdbcBatchItemWriter<NewDocument> writer() {
        return new JdbcBatchItemWriterBuilder<NewDocument>()
                .dataSource(newDataSource)
                .sql("INSERT INTO documents (id, title, content, migrated_at) VALUES (:id, :title, :content, :migratedAt)")
                .beanMapped()
                .build();
    }
}
```

## 실패했을 때 재처리가 가능한 이유 — 메타데이터 테이블

Spring Batch는 비즈니스 테이블(`documents` 같은)과는 별도로, **자체 메타데이터 테이블**이 있어야 동작한다.

- `BATCH_JOB_INSTANCE`, `BATCH_JOB_EXECUTION`, `BATCH_JOB_EXECUTION_PARAMS`
- `BATCH_STEP_EXECUTION`, `BATCH_STEP_EXECUTION_CONTEXT`, `BATCH_JOB_EXECUTION_CONTEXT`

여기에 "이 Job이 언제 실행됐는지, 어느 Step까지 성공했는지, 몇 번째 청크까지 처리했는지"가 기록된다. 이 상태가 없으면 재시작 시 어디서부터 이어야 할지 알 방법이 없다 — 그래서 3번째 청크(1501~2000번째 행)에서 실패해도, Job을 다시 실행하면 처음부터가 아니라 실패 지점부터 이어서 처리할 수 있다.

**생성 방법**: `spring-batch-core`에 내장된 DDL 스크립트(`schema-mysql.sql` 등)로 자동 생성 가능. 개발 환경은 `spring.batch.jdbc.initialize-schema=always`로 편하게, 운영 환경은 보통 Flyway/Liquibase로 한 번만 생성해두고 `initialize-schema=never`로 끈다.

**같은 DB에 둬야 하나**: 꼭 그럴 필요는 없지만(별도 DB 분리도 가능), 보통은 배치가 도는 같은 DB 안에 별도 테이블로 둔다.

## 알려진 한계 — JdbcPagingItemReader의 오프셋 성능

페이지 번호(오프셋)가 커질수록 조회 성능이 떨어질 수 있다는 게 알려진 한계다. 대용량 마이그레이션에서 이 문제를 실제로 겪었다면, 커서 기반 페이징(마지막으로 읽은 id를 기준으로 `WHERE id > ?`)으로 바꾸는 식의 대응이 필요하다.

## 한 줄 정리
> Spring Batch는 대용량 데이터를 Chunk 단위로 나눠 메모리 안전하게 처리하고, 자체 메타데이터 테이블에 진행 상태를 기록해서 실패해도 처음부터 다시 돌지 않고 이어서 재처리할 수 있게 해준다.
