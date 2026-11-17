---
date: 2026-10-18
lastmod: 2026-10-18
tags:
draft: false
---
# Prometheus·Grafana·AlertManager는 어떻게 함께 동작하나

"모니터링 구축해 봤어요"라고 말하면 면접관은 거의 항상 "그래서 지표는 누가 어떻게 가져가고, 알림은 언제 울리나요?"를 묻습니다. 세 도구가 각자 무슨 일을 하는지와, 알림이 울리기까지의 흐름을 한 번에 정리해 둡니다.

![[모니터링 동작 흐름-전체구조.svg]]

## 세 도구의 역할 나누기

헷갈리는 지점은 "Grafana가 모니터링을 한다"고 생각하는 것입니다. 정확히는 **Grafana는 그리기만** 합니다. 지표를 모으고 저장하고 알림 조건을 검사하는 건 Prometheus입니다.

| 도구 | 하는 일 | 비유 |
|---|---|---|
| 앱 (Actuator + Micrometer) | 자기 상태 지표를 주소(`/actuator/prometheus`)로 열어 둠 | 계량기 |
| Prometheus | 주기적으로 가져가서(scrape) 시계열로 저장, 알림 규칙 평가 | 검침원 + 장부 |
| Grafana | Prometheus에 PromQL로 물어보고 그래프로 그림 | 장부를 보기 좋게 만든 보고서 |
| AlertManager | Prometheus가 보낸 알림을 묶고, 중복 제거하고, 보낼 곳을 정함 | 비서 (전화 교환) |

## 흐름 따라가기

그림의 번호 순서대로 보면 됩니다.

1. **대상 찾기** — Kubernetes에서는 Prometheus가 서비스 디스커버리로 새 Pod를 자동으로 찾습니다. Pod가 늘었다 줄어도 설정을 손댈 필요가 없습니다.
2. **가져가기 (Pull)** — 앱이 지표를 "보내는" 게 아니라, Prometheus가 주기적으로 각 대상의 주소를 호출해서 가져갑니다.
3. **저장** — 가져온 값은 `지표 이름 + 라벨 + 시각 + 값` 형태의 시계열로 TSDB에 쌓입니다.
4. **알림 규칙 평가** — 규칙의 조건(`expr`)이 지속 시간(`for`) 동안 계속 참이면 알림이 `firing`이 되어 AlertManager로 갑니다.
5. **조회** — Grafana는 저장된 값을 PromQL로 물어봐서 대시보드를 그립니다.
6. **알림 정리** — AlertManager가 같은 장애로 쏟아진 알림을 하나로 묶고, 상위 장애(Pod 다운)가 있으면 하위 알림(그 Pod의 에러)을 억제하고, 보낼 곳을 고릅니다.
7. **전달** — Slack·메일로 담당자에게 갑니다.
8. **대응** — 알림에 대시보드 링크를 넣어 두면, 받은 사람이 바로 같은 시간대 지표를 겹쳐 보며 원인 범위를 좁힐 수 있습니다.

지표를 내보내는 쪽은 앱만 있는 게 아닙니다.

| 수집 대상 | 무엇을 알려 주나 |
|---|---|
| Spring Boot 앱 (Micrometer) | JVM 힙·GC, HTTP 요청 수·에러·응답 시간, Kafka 리스너 처리 시간, 클라이언트 측 Lag |
| kafka-exporter | 브로커에서 조회한 컨슈머 그룹·파티션별 Lag — **컨슈머가 죽어 있어도** 보임 |
| kube-state-metrics · cAdvisor | Pod 재시작 횟수, OOMKilled, 컨테이너 CPU·메모리 |

## 왜 Pull 방식인가

| | Pull — Prometheus | Push — StatsD, Pushgateway |
|---|---|---|
| 수집 주체 | Prometheus가 가져감 | 앱이 수집 서버로 보냄 |
| 대상이 죽으면 | 가져가기 실패 → 바로 "죽음"으로 감지 (`up == 0`) | 데이터가 안 올 뿐, 죽은 건지 조용한 건지 구분이 어려움 |
| K8s 궁합 | 새 Pod 자동 수집 | 앱마다 수집 서버 주소 설정 필요 |
| 약점 | 금방 끝나는 배치 작업은 가져가기 전에 끝날 수 있음 → 이때만 Pushgateway | — |

## 알림이 울리기까지: inactive → pending → firing → resolved

알림 규칙에서 제일 중요한 건 `for`입니다.

```yaml
- alert: JvmHeapHigh
  expr: sum by (application) (jvm_memory_used_bytes{area="heap"})
        / sum by (application) (jvm_memory_max_bytes{area="heap"}) > 0.9
  for: 5m        # 5분 동안 계속 참이어야 firing (숫자는 예시)
```

- 조건이 참이 되면 바로 울리지 않고 `pending`으로 지켜봅니다.
- `for` 시간 안에 조건이 다시 거짓이 되면 `inactive`로 돌아갑니다. **순간 튀는 값은 여기서 걸러집니다.**
- `for` 동안 계속 참이면 `firing` → AlertManager로 전송.
- 조건이 풀리면 `resolved` 알림이 갑니다.

`for` 없이 걸면 GC 한 번, 배포 한 번에도 알림이 울리고, 그러다 보면 아무도 알림을 안 보게 됩니다.

## 무엇을 알림으로 걸 것인가

대시보드에는 많이 띄우되, **알림은 "사람이 지금 움직여야 하는 조건"만** 겁니다. 서비스 운영에서 자주 쓰는 네 가지는 이렇습니다.

| 알림 | 잡는 장애 | 왜 필요한가 |
|---|---|---|
| JVM 힙/GC | 메모리 누수 → OOM → 재시작 | 재시작 알림만으로는 이미 늦음 |
| HTTP 5xx·응답 시간 | 사용자가 겪는 실패·지연 | 사용자 체감과 가장 가까움 |
| Kafka Consumer Lag | 메시지가 늦게 도착 | 에러 없이 "느려지는 장애"를 잡음 |
| Pod 다운/재시작 | 프로세스가 죽음 | 지표가 아예 안 나올 때의 안전망 |

증상 지표(에러·지연·Lag)로 "문제가 있다"를 알고, 원인 후보 지표(힙·GC·재시작·CPU)를 같은 대시보드에 겹쳐 보며 범위를 좁히는 순서로 대시보드를 짜면 대응이 빨라집니다.

메모리 그래프는 모양으로 원인을 구분합니다.

| 그래프 모양 | 판단 | 다음 행동 |
|---|---|---|
| GC 후에도 바닥선이 계속 오름 | 누수 | 힙 덤프 → 원인 객체 찾기 |
| 트래픽과 같이 오르고 내림 | 용량 부족 | 힙·리소스 조정, 스케일 아웃 |
| 힙은 여유인데 Pod가 OOMKilled | 힙 바깥 메모리 부족 | 컨테이너 제한 대비 힙 비율(`MaxRAMPercentage`) 조정 |

## Kafka 컨슈머 처리 시간도 볼 수 있나

볼 수 있습니다. Spring Kafka는 Micrometer가 있으면 리스너 처리 시간을 타이머로 기록하고, Spring Boot가 Kafka 클라이언트 지표도 자동으로 Micrometer에 연결합니다.

| 보고 싶은 것 | Prometheus 메트릭 예 |
|---|---|
| 리스너 처리 시간 | `spring_kafka_listener_seconds_count / _sum / _max` (리스너 이름, 성공/실패 라벨) |
| 소비 속도·fetch 지연 | `kafka_consumer_fetch_manager_records_consumed_rate`, `..._fetch_latency_avg` |
| 컨슈머가 본 Lag | `kafka_consumer_fetch_manager_records_lag_max` |
| 그룹·파티션별 Lag | `kafka_consumergroup_lag` (kafka-exporter) |

평균 처리 시간은 `sum / count`로 구하고, p99가 필요하면 히스토그램 설정을 따로 켭니다.

```yaml
management:
  metrics:
    distribution:
      percentiles-histogram:
        spring.kafka.listener: true
        http.server.requests: true
```

**주의:** 배치 리스너는 타이머가 "1건"이 아니라 **"배치 한 번 호출"**을 잽니다. 건별 소비와 배치 소비를 이 값으로 그대로 비교하면 틀립니다. 건당 시간으로 환산하거나 CPU·Lag 해소 속도로 비교해야 합니다.

## 흔한 실수

- **라벨에 userId·channelId를 다는 것** — 라벨 값 조합마다 시계열이 따로 생겨서 Prometheus 메모리가 폭증합니다(고카디널리티). ID는 로그·추적으로 보고, 라벨에는 서비스 이름·URI 템플릿·상태 코드처럼 값 종류가 정해진 것만 씁니다.
- **집계하면서 서비스 라벨을 날리는 것** — `sum(...)`만 쓰면 어느 서비스 알림인지 사라집니다. `sum by (application)`처럼 라벨을 남겨야 알림이 맞는 곳으로 갑니다.
- **Prometheus 자신의 장애를 잊는 것** — Prometheus가 죽으면 알림도 안 옵니다. 항상 울리는 Watchdog 알림이 끊기면 "모니터링이 죽었다"고 보는 장치(dead man's switch)가 필요합니다.

## 한 줄 정리
> 앱은 지표 주소만 열어 두고, Prometheus가 가져가 저장하며 `for` 동안 계속된 조건만 알림으로 올리고, AlertManager가 묶어서 보내고, Grafana는 그 장부를 그려서 원인을 좁히게 해 준다.
