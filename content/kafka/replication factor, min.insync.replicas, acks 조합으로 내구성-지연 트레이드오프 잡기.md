---
date: 2026-08-31
lastmod: 2026-08-31
tags:
draft: false
---
이 세 설정은 따로 노는 값이 아니라, "어느 정도의 장애까지 버틸 것인가"와 "그 대가로 얼마의 지연을 감수할 것인가"를 함께 결정하는 하나의 세트다.

## 각 설정의 역할

- **replication factor**: 파티션 하나를 몇 개의 브로커에 복제할지 (예: 3 = 리더 1 + 팔로워 2)
- **min.insync.replicas (ISR)**: 쓰기 성공으로 인정하기 위해 최소 몇 개의 복제본이 동기화돼 있어야 하는지
- **acks=all(-1)**: 프로듀서가 min.insync.replicas 조건이 충족될 때까지 응답을 기다림 (`acks=0`은 응답 대기 없음, `acks=1`은 리더에만 쓰이면 응답)

## 내구성 vs 지연 트레이드오프

- **내구성 최대**: `replication factor=3`, `min.insync.replicas=2`, `acks=all` → 브로커 1대가 죽어도 데이터 유실 없음, 대신 여러 브로커 응답을 기다려 지연 증가
- **지연 최소**: `acks=1`(리더에만 쓰이면 응답) 또는 `acks=0`(응답 대기 없음) → 처리량·지연은 유리하지만 리더가 복제 전에 죽으면 메시지 유실 가능

## min.insync.replicas가 replication factor와 같으면 안 되는 이유

`acks=all`이어도 `min.insync.replicas=1`이면 사실상 `acks=1`과 큰 차이가 없다. 반대로 `min.insync.replicas`가 `replication factor`와 같거나 너무 크면, 브로커 1대만 느려져도 쓰기 자체가 거부(`NotEnoughReplicasException`)되어 가용성이 저하된다.

설정: `replication factor=3`, `min.insync.replicas=3` (전부 동기화돼야만 쓰기 성공)

```
정상 상황
  브로커1(리더)   ✅ 최신
  브로커2(팔로워) ✅ 최신
  브로커3(팔로워) ✅ 최신
  → ISR = 3개, 조건 충족 → 쓰기 성공

브로커3 장애 발생
  브로커1(리더)   ✅ 최신
  브로커2(팔로워) ✅ 최신
  브로커3(팔로워) ❌ 응답 없음 → ISR에서 제외
  → ISR = 2개, min.insync.replicas=3 조건 불충족
  → NotEnoughReplicasException 발생, 브로커1·2가 멀쩡해도 전체 쓰기 거부
```

`min.insync.replicas=2`였다면 같은 상황에서 ISR=2로 조건을 충족해 쓰기가 계속 성공한다. 실무 균형점은 `replication factor=3` + `min.insync.replicas=2` — 브로커 1대 다운에도 쓰기는 계속되고 데이터도 유실되지 않는다.

## "느려지는 것"도 다운과 같은 결과(ISR 제외)로 이어진다

카프카는 `replica.lag.time.max.ms`(기본 30초) 안에 팔로워가 리더를 따라오지 못하면, 브로커가 죽지 않았어도 ISR에서 제외한다. "느려지는" 대표적 원인:

| 원인 | 상황 |
|---|---|
| GC(가비지 컬렉션) 정지 | JVM Full GC로 20~40초간 스레드 정지 → 복제 지연 → ISR 제외 |
| 디스크 I/O 병목 | 다른 파티션 쓰기로 디스크 과부하 → 복제 쓰기 속도 저하 → lag 누적 |
| 네트워크 지연 | 리더-팔로워 간 일시적 혼잡 → 복제 요청/응답 지연 |
| CPU 과부하 | 같은 서버의 다른 프로세스가 CPU 점유 → 카프카 스케줄링 지연 |

이런 "일시적 느려짐"은 GC·디스크·네트워크 상황에 따라 정상 운영 중에도 예측 없이 흔하게 발생하므로, `min.insync.replicas`를 `replication factor`보다 1 낮게 잡아두면(3벌 중 2개) 이 정도는 쓰기 가용성에 영향 없이 흡수할 수 있다.

관련: `acks=all`은 [[아웃박스 패턴 심화 - 재시도, 순서 보장, Dual Write 문제]]에서 outbox 릴레이 발행 신뢰성의 전제 조건으로도 다뤘다. 토픽별로 이 조합을 다르게 적용해본 경험(결제=`acks=all`+`min.insync.replicas=2`, 로그성 데이터=`acks=1`)까지 나오면 장애 시나리오를 놓고 내구성-지연-가용성을 조율해본 경험으로 평가된다.

## 한 줄 정리
> replication factor·min.insync.replicas·acks는 하나의 세트로, `min.insync.replicas`를 `replication factor`보다 1 낮게 두는 게 실무 균형점이다 — GC·디스크·네트워크로 인한 일시적 ISR 제외까지 흡수하면서 브로커 1대 다운까지는 데이터 유실 없이 버틴다.
