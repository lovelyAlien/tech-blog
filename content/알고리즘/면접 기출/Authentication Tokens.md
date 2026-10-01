---
date: 2026-10-01
lastmod: 2026-10-01
tags:
draft: false
---
# Authentication Tokens: 해시맵에 만료 시각만 저장하면 끝

생성/리셋 커맨드를 시간순으로 처리한 뒤 마지막 시각에 살아 있는 토큰 수를 세는 시뮬레이션 문제다. 알고리즘보다 **만료 경계 조건을 정확히 정하는 것**이 핵심이다.

- 출처: 실제 라이브코딩 면접에서 출제된 문제 (HackerRank 환경)
- 공개된 동일/유사 문제: [1point3acres - Count Valid Tokens](https://www.1point3acres.com/interview/problems/citadel-count-valid-tokens), LeetCode 1797. Design Authentication Manager

## 문제 요약

`expiryLimit`과 커맨드 목록 `[type, token_id, T]`가 주어진다.

- `type = 0` (생성): 토큰의 만료 시각을 `T + expiryLimit`으로 정한다.
- `type = 1` (리셋): 토큰이 존재하고 **아직 만료되지 않았을 때만** 만료 시각을 `T + expiryLimit`으로 갱신한다. 이미 만료됐거나 없는 토큰이면 무시한다.
- 마지막 커맨드 시각에 유효한 토큰 수를 반환한다.

```
expiryLimit = 4
commands = [[0,1,1], [0,2,2], [1,1,5], [1,2,7]]

[0,1,1] 토큰1 생성 → 만료 5
[0,2,2] 토큰2 생성 → 만료 6
[1,1,5] 토큰1 리셋: 5 >= 5 이므로 유효 → 만료 9
[1,2,7] 토큰2 리셋: 6 < 7 이므로 만료됨 → 무시

마지막 시각 7 기준: 토큰1(9) 유효, 토큰2(6) 만료 → 1
```

## 접근 (핵심 아이디어)

"각 시각마다 살아 있는 토큰 집합"을 관리하려고 하면 복잡해진다. 관점을 바꾸면 **토큰마다 만료 시각 하나만 알면 된다.**

- 유효한지 판단하는 식은 `만료 시각 >= 현재 시각` 하나뿐이다.
- 그래서 `token_id → 만료 시각` 해시맵 하나로 생성, 리셋, 최종 집계를 모두 처리할 수 있다.
- 만료된 토큰을 맵에서 지울 필요도 없다. 마지막에 셀 때 걸러내면 된다.

## 제출한 풀이

```java
static int countValidTokens(int expiryLimit, int[][] commands) {
    Map<Integer, Integer> expiry = new HashMap<>();
    int lastTime = 0;

    for (int[] cmd : commands) {
        int type = cmd[0], id = cmd[1], t = cmd[2];
        lastTime = Math.max(lastTime, t);

        if (type == 0) {
            expiry.put(id, t + expiryLimit);
        } else {
            Integer exp = expiry.get(id);
            if (exp != null && exp >= t) {   // 아직 만료되지 않았을 때만 리셋
                expiry.put(id, t + expiryLimit);
            }
        }
    }

    int count = 0;
    for (int exp : expiry.values()) {
        if (exp >= lastTime) count++;
    }
    return count;
}
```

시간 복잡도는 O(n)이고, 공간 복잡도는 O(토큰 수)다.

## 핵심 포인트

- **상태를 하나로 줄이기**: 토큰의 상태(존재 여부, 유효 여부)는 결국 만료 시각 하나에서 나온다. "맵에 없으면 미생성, 있으면 `exp >= t`로 유효 판정"이라는 규칙만 지키면 된다.
- **리셋의 의미**: 리셋은 "유효할 때만 연장"이다. 만료된 토큰을 리셋으로 되살리지 않는다는 점이 생성과의 유일한 차이다.
- **최종 기준 시각**: 마지막 커맨드의 시각이다. 입력이 정렬돼 있지 않을 가능성에 대비해 `max(T)`로 잡았다.

## 주의할 점 / 흔한 실수

- **만료 경계 `>=` vs `>`**: 만료 시각과 현재 시각이 같을 때 유효한지는 문제마다 다르다. 이 문제(HackerRank 버전)는 보통 "만료 시각까지 유효"(`>=`)로 알려져 있다. LeetCode 1797은 같은 시각이면 이미 만료로 처리한다(`>`). **라이브코딩에서는 코드를 쓰기 전에 면접관에게 먼저 확인한다.**
- **입력 정렬 여부**: 커맨드가 T 순으로 정렬돼 있다는 보장이 없으면 먼저 정렬해야 한다. 정렬하지 않고 순서대로 처리하면 리셋 시점의 만료 판정이 틀어진다.
- **존재하지 않는 토큰 리셋**: `expiry.get(id)`가 `null`일 수 있다. 언박싱하다가 NPE가 나지 않도록 `Integer`로 받고 null을 먼저 체크한다.
- **만료된 토큰 재생성**: `type 0`은 만료 여부와 상관없이 덮어쓴다고 가정했다. 문제에 따라 다를 수 있으니 확인할 부분이다.

## 한 줄 정리
> `token_id → 만료 시각` 해시맵 하나로 생성은 덮어쓰고, 리셋은 `exp >= t`일 때만 연장한 뒤 마지막 시각 기준으로 센다. 경계 조건(`>=`/`>`)은 먼저 물어본다.
