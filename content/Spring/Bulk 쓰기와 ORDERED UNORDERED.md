---
date: 2026-10-16
lastmod: 2026-10-16
tags:
draft: false
---
# Bulk 쓰기는 무엇을 빠르게 하고, ORDERED와 UNORDERED는 언제 쓰는가

카카오페이 Spring Batch Partitioning 사례는 Writer를 `saveAll()` 대신 MongoDB Bulk Operations로 바꿨다. "Bulk로 바꾸면 빨라진다"까지는 쉽지만, **무엇이** 빨라지는지, 메모리와는 무슨 관계인지, 중간에 실패하면 어떻게 되는지까지 말할 수 있어야 면접 꼬리 질문을 버틴다.

## Bulk가 줄이는 건 네트워크 왕복이다

DB에 요청을 한 번 보내고 응답을 받는 데는 데이터 양과 상관없이 **기본으로 드는 시간(왕복 시간)** 이 있다. 설명을 위해 1회 왕복에 1ms가 든다고 가정하면 이렇다.

```
1건씩 1,000번 요청:  1ms × 1,000 = 1,000ms  + DB가 요청 1,000개를 각각 해석·응답
1,000건 묶어 1번:    1ms × 1     =     1ms  + DB가 요청 1개를 해석하고 한꺼번에 처리
```

택배로 치면 물건 1,000개를 1개씩 1,000번 부치느냐, 상자 하나에 담아 1번 부치느냐다. 물건 무게는 같아도 **왕복 횟수**가 다르다.

## Writer 호출 횟수와 DB 요청 횟수는 다르다

chunkSize가 1,000이고 데이터가 5,000건이면 Writer는 **5번** 호출된다. 하지만 Writer 안에서 DB로 요청이 몇 번 나가는지는 Writer 구현에 달렸다.

| Writer 구현 | Writer 호출 | DB 요청 |
|---|---|---|
| 문서마다 개별 저장 (원문이 설명하는 `saveAll()`) | 5번 | 1,000 × 5 = **5,000번** |
| Bulk Operations | 5번 | 1 × 5 = **5번** |

## Bulk는 메모리가 아니라 속도 대책이다

Chunk는 **한 스레드가 read → process → write를 순서대로** 처리한다.

```
스레드 5:  [read ×1000] → [process ×1000] → [write 1번 ... 느림 ...] → [read ×1000] → ...
                                                  ↑
                                     이동안 이 스레드는 쓰기만 하고 있음
                                     → 읽을 사람이 없으니 다음 데이터가 쌓이지 않음
```

혼자 일하는 요리사의 설거지가 느리다고 재료가 쌓이지는 않는다. 설거지하는 동안에는 재료 손질도 못 하니까. 그래서 Writer가 느리면 **전체가 느려질 뿐 메모리는 쌓이지 않는다.** 메모리에는 항상 Chunk 하나(1,000건)만큼만 있다.

Writer를 빠르게 만들면 Reader가 덜 기다리니 **전체가 빨라진다.** Bulk가 하는 일이 바로 이것이다.

```
saveAll(원문 설명): [읽기 ■■] [가공 ■] [쓰기 ■■■■■■■■■■]   ← 1,000번 왕복
Bulk:              [읽기 ■■] [가공 ■] [쓰기 ■]              ← 1번 왕복
```

- 메모리: 두 경우 모두 Chunk 1,000건으로 같다.
- 속도: 쓰기 시간이 줄어든 만큼 빨라진다.

> 내 해석: 원문은 "쓰기가 읽기보다 느리면 메모리에 데이터가 쌓여 OOM이 날 수 있다"고 쓴다. 이 말은 읽는 스레드와 쓰는 스레드가 따로 돌고 중간에 대기열이 있는 **비동기 구조**에서 맞다. 원문처럼 한 스레드가 순서대로 처리하는 Chunk 구조에서는 쌓이지 않는다. 원문이 덧붙인 "객체가 메모리에 머무는 시간이 줄어 GC 부담이 준다"는 맞는 말이지만 부수 효과다.

## saveAll과 Bulk 비교 (원문 설명 기준)

| 항목 | `saveAll()` | `BulkOperations.insert()` |
|---|---|---|
| 동작 | 문서마다 `save()` 개별 호출, `_id`로 INSERT/UPDATE 판별 | 문서를 WriteModel로 모아 두고 `execute()` 한 번에 `bulkWrite` |
| 네트워크 요청 | N번 | 1번 |
| 실패 시 | 첫 실패에서 예외 | UNORDERED면 일부 실패해도 계속 |
| 적합한 곳 | 소량, UPDATE 포함 | 대용량 INSERT, 배치 |

## 코드: 모드는 Writer 안에서 정한다

"Bulk Writer"는 Spring Batch에 있는 클래스 이름이 아니다. `BulkOperations`를 써서 **직접 만든 ItemWriter**다.

```java
@Bean
public ItemWriter<Statistics> writer() {
    return chunk -> {
        if (chunk.isEmpty()) return;

        BulkOperations bulkOps = mongoTemplate.bulkOps(
                BulkOperations.BulkMode.UNORDERED,   // ← 모드 지정. 안 쓰면 ORDERED가 기본
                Statistics.class,
                STATISTICS_COLLECTION);

        bulkOps.insert(new ArrayList<>(chunk.getItems()));
        bulkOps.execute();                           // 여기서 한 번의 bulkWrite로 전송
    };
}
```

`write()`가 끝나면 그 Chunk 목록은 스코프를 벗어나 GC 대상이 된다. 따로 `clear()`할 필요는 없다.

## ORDERED와 UNORDERED

1,000건을 보냈는데 300번째에서 에러가 났다고 하자.

| 모드 | 결과 |
|---|---|
| **ORDERED** (기본값) | 1\~299번째는 저장되고, 300번째에서 **멈춘다**. 301\~1,000번째는 **아예 실행되지 않고** 에러와 함께 끝난다 |
| **UNORDERED** | 300번째만 실패하고 **나머지 999건은 저장된다**. 실패 정보를 끝나고 한꺼번에 돌려준다. 순서를 지키지 않아도 되니 MongoDB가 내부적으로 병렬 쓰기를 최적화할 수 있다 |

기준은 **"앞의 작업 결과에 뒤의 작업이 기대는가"** 다.

| ORDERED를 쓸 때 | UNORDERED를 쓸 때 |
|---|---|
| 같은 문서를 넣고 → 수정하는 작업 | 서로 독립적인 문서를 대량으로 넣을 때 |
| 삭제 후 재삽입처럼 순서가 바뀌면 결과가 달라질 때 | 통계·로그·백업 데이터 적재 (원문 사례) |
| 하나가 실패하면 뒤는 하면 안 될 때 | 일부 실패는 나중에 따로 처리해도 될 때 |

원문도 "통계 데이터끼리 서로 독립적이고 저장 순서가 결과에 영향을 주지 않아서" UNORDERED를 골랐다.

## 실패하면 어떻게 되나

"실패 목록"과 "롤백"은 서로 다른 곳의 이야기다.

- **실패 목록**은 MongoDB가 Bulk 결과로 돌려주는 정보다(`BulkOperationException` 안의 에러 목록 등). Spring Batch가 실패 건을 자동으로 모아 두는 게 아니다.
- **롤백**은 DB 트랜잭션의 일이다. UNORDERED도 끝나고 나면 "일부 실패"를 예외로 던지고, Spring Batch는 그 Chunk를 실패로 본다.

| | RDB (MySQL 등) | MongoDB (트랜잭션 미사용) |
|---|---|---|
| Chunk 중 에러 | 그 Chunk 1,000건 **전부 롤백** (0건 저장) | 이미 저장된 건 **그대로 남음** |
| Step | 실패로 멈춤 (따로 설정하지 않으면) | 실패로 멈춤 |
| 재시작 | 마지막으로 **커밋한 Chunk 다음부터** 깔끔하게 이어서 | 그 Chunk를 다시 실행 → 이미 들어간 데이터가 **중복**될 수 있음 |

에러 난 건만 건너뛰고 계속 가고 싶으면 Spring Batch의 **skip 설정**을 쓴다. MongoDB처럼 롤백이 안 되는 저장소라면 재시작 중복을 막는 장치(중복 방지 키, upsert 같은 멱등한 쓰기)도 함께 고민해야 한다.

## 내가 헷갈렸던 것

| 처음 이해 | 정확한 이해 |
|---|---|
| Writer 호출 5번 = DB 요청 5번 | Writer 구현에 따라 5번(Bulk)일 수도, 5,000번(개별 저장)일 수도 있다 |
| Bulk는 메모리 대책이다 | **속도** 대책이다. 메모리는 어느 쪽이든 Chunk 크기만큼이다 |
| Writer가 느리면 메모리에 데이터가 쌓여서 Reader가 기다린다 | Reader가 기다리는 건 **같은 스레드가 순서대로 처리**하기 때문이다. 메모리는 쌓이지 않는다 |
| Chunk가 실패하면 1,000개가 롤백되고 실패 목록으로 간다 | 롤백은 DB 트랜잭션에 달렸다(MongoDB는 남는다). 실패 목록은 MongoDB Bulk 결과다 |
| ORDERED에서 실패하면 나머지는 멈춰 있는 상태다 | 멈춰서 기다리는 게 아니라 **실행되지 않고 끝난다** |

## 스스로 확인할 질문

- Bulk는 정확히 무엇을 줄여서 빨라지는가?
- Chunk 구조에서 Writer가 느려지면 메모리와 속도에 각각 어떤 일이 생기는가?
- ORDERED 모드에서 1,000건 중 300번째가 실패하면 몇 건이 저장되는가?
- 통계 데이터 적재에 UNORDERED를 써도 되는 이유는?
- 같은 Chunk 실패가 RDB와 MongoDB에서 재시작 결과를 어떻게 다르게 만드는가?

## 확인 필요

- Spring Data MongoDB의 `SimpleMongoRepository.saveAll()`은 엔티티가 모두 신규(isNew)이면 `insertAll`로 일괄 삽입하는 분기가 있는 것으로 안다. 그렇다면 "saveAll은 항상 N번 요청"이라는 원문 설명은 버전과 엔티티 상태에 따라 다를 수 있다. 소스 코드로 확인할 것
- UNORDERED 일부 실패 시 Spring Batch Writer까지 올라오는 예외 타입과 skip 설정 시 동작 확인

## 한 줄 정리

> Bulk는 Chunk 하나를 한 번의 왕복으로 보내서 쓰기 시간을 줄이는 **속도** 대책이다. 독립적인 데이터면 UNORDERED로 실패해도 나머지를 진행하고, 롤백 여부는 DB 트랜잭션에 달려 있으니 재시작 중복까지 고려해야 한다.

## 관련 노트

- [[Spring Batch Partitioning 면접 설명과 성능 결과 해석]]
- [[Spring Batch Partitioning 구조와 처리 흐름]]
- [[Paging과 Cursor 조회는 무엇이 다른가]]
- [[Spring Batch 구성 요소]]
- [[Spring Batch 핵심 정리]]
