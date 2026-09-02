---
date: 2026-08-31
lastmod: 2026-08-31
tags:
draft: false
---
[[파티션 할당 전략 - Range, RoundRobin, Sticky, CooperativeSticky]]에서 정리한 CooperativeStickyAssignor는 리밸런싱이 "일어났을 때" 영향 범위를 줄이는 개선이다. Static Membership(KIP-345)은 한 걸음 더 나아가서, 배포로 인한 짧은 재시작이라면 **리밸런싱 자체를 생략**시켜버리는 접근이다.

## stop-the-world가 반복되는 이유

리밸런싱은 컨슈머 그룹 안에서 파티션을 컨슈머들에게 나눠 배정하는 과정인데, 그룹 멤버가 바뀔 때마다(배포로 컨슈머 재기동 등) 이 배정을 다시 계산해야 한다. 2.4 이전(Eager Rebalancing)에서는 멤버 하나만 바뀌어도 그룹 전체가 파티션을 반납하고 재배정을 기다리는 동안 **관련 없는 다른 컨슈머까지 포함해 그룹 전체가 잠깐 메시지를 못 읽었다.** 마이크로서비스 환경은 배포가 잦아서 이 멈춤이 반복적으로 체감된다.

## Static Membership의 핵심: "그룹을 나간 것"이 아니라고 인정시키기

컨슈머에 고유 ID(`group.instance.id`)를 부여하면, 그 컨슈머가 종료돼도 카프카는 일정 타임아웃 동안 리밸런싱을 보류하고 기다린다. 같은 ID로 다시 접속하면 원래 파티션을 그대로 돌려받고, **리밸런싱 자체가 발생하지 않는다.** 타임아웃을 넘기면 그때는 리밸런싱이 정상적으로 발생한다.

## `group.instance.id`는 어떻게 "같은 값"을 유지하나

리밸런싱 생략은 같은 ID로 컨슈머가 다시 올라와야 가능한데, 그 "같은 ID"는 어떻게 보장될까.

전제부터 짚어야 한다 — `group.instance.id`는 카프카가 자동으로 발급하는 값이 아니라, **컨슈머 애플리케이션 설정에 개발자가 직접 넣는 값**이다. 카프카는 이 값을 그냥 믿고 처리할 뿐, 스스로 부여하거나 검증하지 않는다. 즉 "재시작 후에도 같은 값을 유지시켜주는 것"은 카프카가 아니라 **배포 환경(오케스트레이션)의 책임**이다.

만족해야 할 조건은 두 가지뿐이고, 값의 형태는 자유다.

1. 유일성 — 같은 컨슈머 그룹 안에서 다른 인스턴스와 값이 겹치면 안 됨
2. 안정성 — 그 인스턴스가 재시작되어도 같은 값을 다시 써야 함

## Kubernetes StatefulSet + replicas 조합이 이 조건을 자동으로 만족시킨다

`StatefulSet`에 `replicas: 3`을 주면, 각 replica가 순번이 매겨진 고정 파드 이름을 자동으로 받는다: `payment-consumer-0`, `payment-consumer-1`, `payment-consumer-2`. 각 파드는 재시작돼도 항상 같은 순번(같은 이름)으로 다시 뜨므로, 파드 이름을 그대로 `group.instance.id`로 주입하면 별도 관리 없이 조건이 충족된다.

```yaml
env:
  - name: GROUP_INSTANCE_ID
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
```

## 반대로 일반 Deployment + replicas는 문제가 된다

`Deployment`의 파드 이름은 재시작마다 랜덤 해시로 바뀐다(`payment-consumer-7f9c8d-x2kq1` 등). 파드 이름을 그대로 쓰면 재시작마다 새 ID로 인식되어 Static Membership이 사실상 무력화된다.

해법은 두 가지다.

1. StatefulSet으로 전환하는 것이 정석이다 — 컨슈머처럼 "각 인스턴스가 고유 정체성을 유지해야 하는" 워크로드는 원래 StatefulSet이 적합한 대상이다.
2. 어렵다면 PVC(영구 볼륨)에 ID를 저장해두고 재시작 시 읽어오는 방식도 가능하지만 구현이 번거롭다.

| 배포 방식 | replica의 파드 이름 | Static Membership 적용 |
|---|---|---|
| StatefulSet | 고정 (`-0`, `-1`, `-2`, 재시작해도 유지) | 파드 이름을 그대로 ID로 사용 가능 (권장) |
| Deployment | 랜덤 해시 (재시작마다 바뀜) | 별도 안정적 ID 관리 필요, 안 하면 사실상 효과 없음 |

카프카 컨슈머를 여러 replica로 운영할 계획이라면, 애초에 Deployment가 아니라 StatefulSet으로 설계하는 것이 Static Membership을 자연스럽게 활용하는 길이다.

관련: 소유권이 리밸런싱을 통해 어떻게 만들어지고 검증되는지는 [[파티션 소유권과 리밸런싱의 관계]] 참고. 리밸런싱을 촉발하는 타임아웃 판정 기준은 [[session.timeout.ms와 max.poll.interval.ms 차이]] 참고.

## 한 줄 정리
> Static Membership은 `group.instance.id`로 "같은 컨슈머가 잠깐 재시작한 것"임을 카프카에 알려 리밸런싱 자체를 생략시키는 기능이고, 이 ID의 유일성·안정성은 카프카가 아니라 배포 환경이 책임진다. Kubernetes StatefulSet은 고정된 파드 이름 덕분에 별도 관리 없이 이 조건을 만족하지만, Deployment는 파드 이름이 재시작마다 바뀌어 그대로 쓰면 Static Membership이 무력화된다.
