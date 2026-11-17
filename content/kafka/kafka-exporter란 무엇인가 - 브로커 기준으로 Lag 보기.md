---
date: 2026-10-18
lastmod: 2026-10-18
tags:
draft: false
---
# kafka-exporter란 무엇인가 - 브로커 기준으로 Lag 보기

Consumer Lag을 Grafana에서 본다고 하면 "그 Lag은 어디서 가져온 값인가요?"라는 질문이 따라옵니다. 앱 안의 Micrometer로도 Lag이 나오지만, 알림을 걸 때는 보통 **브로커 기준**으로 재는 kafka-exporter를 함께 씁니다. 둘이 왜 따로 필요한지 정리해 둡니다.

## kafka-exporter는 무엇인가

kafka-exporter는 **Kafka 브로커에서 토픽·컨슈머 그룹의 오프셋 정보를 읽어 Prometheus 지표로 노출하는 별도 수집기(exporter)**입니다. 흔히 쓰는 건 오픈소스 `danielqsj/kafka-exporter`입니다.

Prometheus는 "/metrics 주소를 열어 둔 대상"만 수집할 수 있는데, Kafka 브로커는 그런 주소를 기본으로 제공하지 않습니다. 그래서 중간에서 브로커에 물어보고 Prometheus 형식으로 바꿔 주는 번역기가 필요하고, 그게 exporter입니다.

> 비유하면, 직원(컨슈머)에게 "일 얼마나 밀렸어요?"라고 묻는 게 Micrometer라면, 창고 입고 장부와 출고 장부(브로커 오프셋)를 직접 대조하는 감사관이 kafka-exporter입니다. 직원이 결근해도 감사관은 밀린 양을 압니다.

## 동작 흐름

![[kafka-exporter 동작 흐름-전체구조.svg]]

1. **파티션 최신 오프셋 조회** — 토픽 파티션마다 지금까지 쓰인 마지막 위치(Log End Offset)를 브로커에 물어봅니다.
2. **그룹별 커밋 오프셋 조회** — 컨슈머 그룹 목록을 받아, 그룹마다 파티션별로 어디까지 커밋했는지 그룹 코디네이터에 물어봅니다. 커밋 위치는 내부 토픽 `__consumer_offsets`에 저장돼 있습니다.
3. **Lag 계산** — 파티션마다 `최신 오프셋 - 커밋 오프셋`을 계산합니다.
4. **노출** — 계산한 값을 `/metrics`(기본 포트 9308)에 Prometheus 텍스트 형식으로 보여 줍니다.
5. **수집** — Prometheus가 주기적으로 가져갑니다(Pull).
6. **활용** — Grafana에서 파티션별 Lag을 그리고, Lag이 계속 늘면 알림을 겁니다.

중요한 건 kafka-exporter가 **메시지를 읽지 않는다**는 점입니다. 일반 Kafka 클라이언트처럼 브로커에 접속하지만 오프셋 정보만 조회합니다. 그래서 브로커나 컨슈머에 주는 부담이 거의 없습니다.

## 왜 컨슈머가 죽어도 보이나

그림의 P3처럼 담당 컨슈머가 죽거나 멈추면 이런 일이 생깁니다.

- 컨슈머가 커밋을 못 하니 **커밋 오프셋이 멈춥니다** (5,000에서 그대로).
- 프로듀서는 계속 쓰니 **최신 오프셋은 계속 오릅니다** (98,000까지).
- 앱 안의 Micrometer 지표는 앱이 죽으면서 **같이 사라집니다.**

kafka-exporter는 두 숫자를 브로커에서 직접 가져오기 때문에, 이 상황에서도 P3의 Lag이 계속 오르는 게 그대로 보입니다. **"컨슈머가 죽었다"는 장애를 Lag으로 잡을 수 있는 이유**가 이것입니다.

## 주요 지표

| 지표 | 뜻 | 쓰는 곳 |
|---|---|---|
| `kafka_topic_partition_current_offset` | 파티션 최신 오프셋 | `rate()`로 파티션별 **유입 속도** → 핫 키 확인 |
| `kafka_topic_partition_oldest_offset` | 파티션에 남아 있는 가장 오래된 오프셋 | 보관 기간(retention)으로 지워진 범위 확인 |
| `kafka_consumergroup_current_offset` | 그룹이 커밋한 오프셋 | `rate()`로 파티션별 **소비 속도** → 멈춘 컨슈머 확인 |
| `kafka_consumergroup_lag` | 파티션별 Lag | 알림, 전체 증가인지 일부 쏠림인지 구분 |
| `kafka_consumergroup_lag_sum` | 그룹 전체 Lag 합 | 대시보드 요약 |
| `kafka_consumergroup_members` | 그룹 멤버 수 | 0이 되면 컨슈머가 전부 내려간 것 |

```promql
# 파티션별 Lag — 전체 증가인지 일부 쏠림인지 구분
sum by (partition) (kafka_consumergroup_lag{consumergroup="my-group", topic="my-topic"})

# Lag이 10분 동안 계속 늘고 있는지 (순간 튐 대신 추세로 알림)
deriv(kafka_consumergroup_lag_sum{consumergroup="my-group"}[10m]) > 0
```

Lag 패턴을 읽는 법은 [[Consumer Lag 패턴으로 원인 찾기 - 전체 파티션 증가 vs 일부 파티션 쏠림]]에 정리해 두었습니다.

## 띄우는 법

Kubernetes에서는 Pod 하나로 따로 띄우고, 브로커 주소만 알려 주면 됩니다.

```bash
docker run -p 9308:9308 danielqsj/kafka-exporter \
  --kafka.server=broker-1:9092 --kafka.server=broker-2:9092
```

```yaml
# Prometheus 수집 설정 (정적 설정 예)
scrape_configs:
  - job_name: kafka-exporter
    static_configs:
      - targets: ['kafka-exporter:9308']
```

컨슈머 애플리케이션마다 붙이는 게 아니라, **클러스터당 하나**면 모든 토픽·그룹의 Lag이 나옵니다.

## Micrometer와 무엇이 다른가

| | Micrometer (앱 안) | kafka-exporter (앱 밖) |
|---|---|---|
| 위치 | 각 컨슈머 애플리케이션 내부 | 별도 프로세스, 클러스터당 하나 |
| 정보 출처 | 컨슈머 클라이언트가 아는 값 | 브로커가 가진 오프셋 |
| 잘 보는 것 | 처리 시간, 소비 속도, fetch 지연, JVM | 그룹·파티션별 Lag, 파티션별 유입 속도 |
| 컨슈머가 죽으면 | 지표가 사라짐 | Lag이 오르는 게 계속 보임 |
| 대표 지표 | `spring_kafka_listener_seconds_*` | `kafka_consumergroup_lag` |

둘은 경쟁 관계가 아니라 역할이 다릅니다. **kafka-exporter는 "얼마나 밀렸나"**를, **Micrometer는 "왜 밀렸나"**를 봅니다. 알림은 컨슈머가 죽어도 동작하는 exporter의 Lag에 걸고, 원인 분석은 Micrometer의 처리 시간과 JVM 지표로 합니다. Micrometer는 [[Micrometer란 무엇인가 - 메트릭계의 SLF4J]]에 정리해 두었습니다.

## 비슷한 도구

| 도구 | 특징 |
|---|---|
| kafka-exporter (danielqsj) | 오프셋·Lag을 그대로 Prometheus 지표로. 가장 단순 |
| Burrow (LinkedIn) | 일정 구간의 오프셋 변화를 보고 그룹 상태를 OK·WARN·ERR로 판정. 자체 HTTP API 제공 |
| kafka-lag-exporter (Lightbend) | Lag을 "몇 건"뿐 아니라 "몇 초 밀렸나"로 추정. 현재는 유지보수가 중단됨 |

## 주의할 점

- **Lag은 "커밋" 기준입니다.** 처리는 끝났는데 커밋이 늦거나 auto-commit 주기가 길면 Lag이 실제보다 크게 보입니다([[Commit Offset과 Current Offset 차이]]).
- **"몇 건"이 곧 "몇 초"는 아닙니다.** 같은 Lag 1,000건이라도 초당 10건 처리하는 그룹과 초당 1만 건 처리하는 그룹은 심각도가 다릅니다. 알림 기준은 Lag 값 자체보다 **계속 늘어나는지(추세)**로 거는 게 낫습니다.
- **오래 멈춘 그룹은 사라질 수 있습니다.** 멤버가 없는 그룹의 커밋 오프셋은 보관 기간(`offsets.retention.minutes`, 최근 버전 기본 7일)이 지나면 삭제됩니다. 그러면 그 그룹의 Lag 지표 자체가 없어지니, 그룹 멤버 수 알림을 함께 두는 게 안전합니다.

## 한 줄 정리
> kafka-exporter는 앱 밖에서 브로커의 두 장부(파티션 최신 오프셋 · 그룹 커밋 오프셋)를 대조해 Lag을 Prometheus 지표로 내보내는 수집기라, 컨슈머가 죽어도 "얼마나 밀렸나"가 보인다. "왜 밀렸나"는 Micrometer로 본다.
