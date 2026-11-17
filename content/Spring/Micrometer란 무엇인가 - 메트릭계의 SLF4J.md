---
date: 2026-10-18
lastmod: 2026-10-18
tags:
draft: false
---
# Micrometer란 무엇인가 - 메트릭계의 SLF4J

Spring Boot에서 `/actuator/prometheus`를 열면 지표가 줄줄이 나옵니다. 그 지표를 실제로 기록하고 Prometheus 형식으로 바꿔 주는 게 Micrometer입니다. "Prometheus를 썼다"고 말하면 "앱 지표는 어떻게 노출했나요?"라는 질문이 이어지기 쉬워서 정리해 둡니다.

## Micrometer는 무엇인가

Micrometer는 **애플리케이션 코드와 모니터링 시스템 사이에 있는 계측(instrumentation) 추상화 라이브러리**입니다.

코드는 카운터, 타이머, 게이지 같은 공통 API로 지표를 **한 번만** 기록합니다. 그 값을 Prometheus, Datadog, OpenTelemetry 같은 시스템별 형식으로 바꾸는 일은 MeterRegistry(지표를 모아 두고 특정 형식으로 내보내는 저장소)가 맡습니다.

로그를 떠올리면 쉽습니다. 코드에서 SLF4J로 로그를 찍으면, 실제 출력을 Logback이 하든 Log4j2가 하든 코드는 신경 쓰지 않습니다. Micrometer가 지표에서 같은 역할을 해서 "메트릭계의 SLF4J"라고 부릅니다.

> 비유하면, 여러 나라에 수출하는 공장이 제품은 한 가지로 만들고 포장만 나라별 규격으로 바꿔 주는 포장 라인입니다.

## 동작 흐름

![[Micrometer 동작 흐름-전체구조.svg]]

1. **지표가 생기는 곳** — Spring이 자동으로 재는 것(HTTP 요청, JVM 힙/GC, Kafka 리스너, 커넥션 풀), 직접 추가한 비즈니스 지표, Kafka 같은 라이브러리 클라이언트 지표가 있습니다.
2. **Micrometer API** — 모두 Counter·Timer·Gauge 같은 공통 방식으로 기록됩니다.
3. **MeterRegistry** — 붙여 둔 레지스트리가 형식을 정합니다. Prometheus용을 붙이면 Prometheus 형식이 되고, 의존성만 바꾸면 다른 시스템으로 교체할 수 있습니다. 앱 코드는 그대로입니다.
4. **노출** — Actuator가 `/actuator/prometheus` 주소에 텍스트로 보여 줍니다.
5. **수집** — Prometheus가 이 주소를 주기적으로 가져갑니다(Pull).
6. **활용** — Grafana 대시보드와 AlertManager 알림으로 이어집니다. 뒷부분 흐름은 [[Prometheus·Grafana·AlertManager는 어떻게 함께 동작하나]]에 정리해 두었습니다.

참고로 Datadog 레지스트리는 앱이 지표를 Datadog으로 **보내는(Push)** 방식입니다. Pull이냐 Push냐도 레지스트리가 정하는 부분입니다.

## 지표 종류 세 가지

| 종류 | 무엇을 재나 | 예 |
|---|---|---|
| Counter | 늘기만 하는 횟수 | 요청 수, 에러 수, 메시지 실패 횟수 |
| Timer | 걸린 시간 + 횟수 (합계·최대값) | HTTP 응답 시간, Kafka 리스너 처리 시간 |
| Gauge | 지금 이 순간의 값 (오르내림) | 힙 사용량, 커넥션 풀 활성 수, 큐 길이 |

Counter는 "지금까지 몇 번"만 기록합니다. 그래서 그래프에서는 보통 PromQL `rate()`로 "초당 몇 번"으로 바꿔서 봅니다. Timer는 `_count`, `_sum`, `_max`로 나뉘어 노출되고, 평균은 `sum / count`로 구합니다.

## Spring Boot에서 켜는 법

의존성 두 개면 자동 계측이 바로 나옵니다.

```groovy
implementation 'org.springframework.boot:spring-boot-starter-actuator'
runtimeOnly 'io.micrometer:micrometer-registry-prometheus'
```

```yaml
management:
  endpoints.web.exposure.include: health, prometheus    # 노출할 엔드포인트
  metrics:
    tags.application: ${spring.application.name}         # 모든 지표에 서비스 이름 태그
    distribution.percentiles-histogram:
      http.server.requests: true                         # p95/p99 계산용 히스토그램
```

`tags.application`을 꼭 넣어 두는 게 좋습니다. 서비스가 여러 개일 때 어느 서비스 지표인지 구분하는 기준이 되고, 알림을 집계할 때도 이 태그로 나눕니다.

## 직접 지표를 추가할 때

```java
// Timer — 메시지 전송에 걸린 시간
Timer.builder("message.send")
     .tag("channelType", type)          // 값 종류가 정해진 것만 태그로
     .register(registry)
     .record(() -> sender.send(msg));

// Counter — 실패 횟수
Counter.builder("message.send.failed")
       .tag("reason", "timeout")
       .register(registry)
       .increment();

// Gauge — 지금 대기 중인 작업 수 (객체를 넘기면 조회할 때마다 값을 읽음)
Gauge.builder("outbox.pending", outboxQueue, Queue::size)
     .register(registry);
```

이름은 점(`.`)으로 쓰면 Prometheus 레지스트리가 알아서 `message_send_seconds_count`처럼 밑줄과 단위를 붙여 바꿔 줍니다. 여기서도 "기록은 공통으로, 형식은 레지스트리가" 구조가 보입니다.

## 주의: 태그에 ID를 넣지 말 것

**Before — 위험**
```java
Timer.builder("message.send")
     .tag("userId", userId)        // 사용자 수만큼 시계열이 생김
     .register(registry);
```

**After — 안전**
```java
Timer.builder("message.send")
     .tag("channelType", type)     // DIRECT / GROUP / NOTICE 처럼 값이 몇 개뿐
     .register(registry);
```

태그 값 조합마다 시계열(Meter)이 따로 만들어집니다. userId·channelId처럼 값 종류가 끝없이 늘어나는 태그를 달면, 앱의 레지스트리 메모리와 Prometheus 메모리가 같이 불어납니다(고카디널리티 문제). 특정 사용자 추적은 로그나 분산 추적으로 하고, 태그에는 서비스 이름·URI 템플릿·상태 코드처럼 값 종류가 정해진 것만 씁니다.

## Micrometer가 못 보는 것

Micrometer는 **앱 안에서** 재기 때문에, 앱이 죽으면 지표도 같이 사라집니다. 대표적인 게 Kafka Lag입니다.

| | Micrometer (앱 안) | kafka-exporter (앱 밖) |
|---|---|---|
| 정보 출처 | 컨슈머 클라이언트가 아는 값 | 브로커가 가진 오프셋 |
| 잘 보는 것 | 처리 시간, 소비 속도, JVM | 그룹·파티션별 Lag, 파티션별 유입 속도 |
| 컨슈머가 죽으면 | 지표가 사라짐 | Lag이 오르는 게 계속 보임 |

그래서 Lag 알림은 브로커 기준인 kafka-exporter 지표에 걸고, "왜 느린가"는 Micrometer의 처리 시간과 JVM 지표로 봅니다. Lag 패턴을 읽는 법은 [[Consumer Lag 패턴으로 원인 찾기 - 전체 파티션 증가 vs 일부 파티션 쏠림]]에 있습니다.

**정확히는:** Spring Boot 3부터는 Micrometer **Observation API**가 들어와서, 한 번의 계측으로 지표(Metrics)와 분산 추적(Tracing)을 함께 만들 수 있습니다. 이 노트에서 다룬 Counter·Timer·Gauge는 그중 지표 쪽입니다.

## 한 줄 정리
> Micrometer는 앱 안에서 지표를 공통 API로 한 번만 기록하고, 붙인 MeterRegistry가 Prometheus·Datadog 등 형식으로 바꿔 내보내게 하는 "메트릭계의 SLF4J"다. 태그에는 값 종류가 정해진 것만 쓴다.
