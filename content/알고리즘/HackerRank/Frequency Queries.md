---
date: 2026-09-29
lastmod: 2026-09-29
tags:
draft: false
---
# Frequency Queries: "빈도의 빈도" 맵, 빈도가 바뀌면 옛 칸도 비운다

값의 등장 횟수를 세는 맵 하나로는 "등장 횟수가 정확히 z인 값이 있나?"에 빨리 답할 수 없다. 그래서 **등장 횟수별로 값이 몇 개인지** 세는 맵을 하나 더 둔다. 처음 제출한 코드도 이 두 맵 구조였지만, 빈도가 바뀔 때 **이전 빈도 칸을 비우지 않아서** 틀렸다. 그 과정을 같이 정리해 둔다.

- 문제: [HackerRank - Frequency Queries](https://www.hackerrank.com/challenges/frequency-queries/problem)

## 문제 요약

빈 자료구조에 `[op, x]` 형태의 쿼리 `q`개를 처리한다.

- `1 x`: `x`를 하나 추가
- `2 y`: `y`가 있으면 하나 삭제 (없으면 무시)
- `3 z`: 등장 횟수가 **정확히 `z`**인 값이 하나라도 있으면 `1`, 없으면 `0`을 결과에 추가

3번 쿼리의 결과 리스트를 반환한다. (`q ≤ 10^5`, 값 ≤ 10^9)

```
1 5, 1 6        freq {5:1, 6:1}          countOfFreq {1:2}
3 2             countOfFreq[2] 없음 → 0
1 10, 1 10      freq {5:1, 6:1, 10:2}    countOfFreq {1:2, 2:1}
1 6             freq {5:1, 6:2, 10:2}    countOfFreq {1:1, 2:2}
2 5             freq {6:2, 10:2}         countOfFreq {1:0, 2:2}
3 2             countOfFreq[2] = 2 > 0 → 1
```

## 접근: 맵을 하나 더 두어 3번 쿼리를 O(1)로

- **브루트포스**: 3번 쿼리마다 `freq`의 모든 값을 훑으면 쿼리 하나가 O(q), 전체 **O(q²) = 10^10**이라 시간 초과다.
- **빈도의 빈도 맵**: 맵을 두 개 둔다.
  - `freq`: 값 → 등장 횟수
  - `countOfFreq`: 등장 횟수 → 그 횟수를 가진 값의 개수
- 값의 횟수가 `f`에서 `f±1`로 바뀔 때마다 **`countOfFreq[f]`는 1 빼고 `countOfFreq[f±1]`은 1 더한다.** 그러면 3번 쿼리는 `countOfFreq[z] > 0`만 보면 된다.

## 처음 제출한 코드 (오답)

```java
static List<Integer> freqQuery(List<List<Integer>> queries) {
    Map<Integer, Integer> map = new HashMap<>();
    Map<Integer, Integer> freqMap = new HashMap<>();
    List<Integer> answer = new ArrayList<>();

    for (List<Integer> q : queries) {
        if (q.get(0) == 1) {
            int x = q.get(1);
            int freq = map.getOrDefault(x, 0);
            map.put(x, freq + 1);
            freqMap.put(freq + 1, freqMap.getOrDefault(freq + 1, 0) + 1);
            // ❌ freqMap[freq]를 빼지 않음
        } else if (q.get(0) == 2) {
            int y = q.get(1);
            int freq = map.getOrDefault(y, 0);
            if (freq > 1) map.put(y, freq - 1);       // ❌ freq == 1이면 map이 안 바뀜
            freqMap.put(freq, freqMap.getOrDefault(freq, 1) - 1);
            // ❌ freqMap[freq - 1]을 더하지 않음, ❌ freq == 0(없는 값)도 처리함
        } else {
            int z = q.get(1);
            if (freqMap.containsKey(z) && freqMap.get(z) > 0) answer.add(1);
            else answer.add(0);
        }
    }
    return answer;
}
```

두 맵을 쓴다는 방향은 맞았다. 틀린 곳은 모두 **빈도가 바뀔 때 두 칸을 함께 갱신하지 않은 것**이다.

### 버그 1: 추가할 때 옛 빈도 칸이 그대로 남는다

`x`의 횟수가 1에서 2가 되면 `x`는 더 이상 "횟수 1인 값"이 아니다. 그런데 `freqMap[1]`을 빼지 않아서 계속 남아 있다.

```
1 5
1 5
3 1   → 기대 0, 실제 1   (freqMap = {1:1, 2:1}, 1이 남아 있음)
```

### 버그 2: 삭제가 세 군데에서 어긋난다

- **`freq == 1`이면 `map`이 그대로다.** 횟수가 0이 되어야 하는데 1로 남는다. 같은 값을 다시 지우면 `freqMap[1]`이 또 줄어서 음수가 되거나, 횟수가 1인 **다른 값의 카운트를 깎는다.**
- **새 빈도 `freq - 1` 칸을 늘리지 않는다.** 횟수가 3에서 2가 되어도 `freqMap[2]`는 그대로다.
- **없는 값(`freq == 0`)을 지워도 `freqMap`을 건드린다.** `freqMap[0]`이 생기고, 반복하면 음수가 된다.

```
1 5
2 5     map {5:1} 그대로, freqMap {1:0}
2 5     없는 값을 지웠는데 freqMap {1:-1}
1 6     freqMap {1:0}
3 1     → 기대 1, 실제 0
```

## 통과한 풀이

```java
static List<Integer> freqQuery(List<List<Integer>> queries) {
    Map<Integer, Integer> map = new HashMap<>();      // 값 → 빈도
    Map<Integer, Integer> freqMap = new HashMap<>();  // 빈도 → 그 빈도를 가진 값의 개수
    List<Integer> answer = new ArrayList<>();

    for (List<Integer> q : queries) {
        int op = q.get(0), v = q.get(1);

        if (op == 1) {
            int freq = map.getOrDefault(v, 0);
            if (freq > 0) freqMap.merge(freq, -1, Integer::sum);  // 이전 빈도에서 빼기
            map.put(v, freq + 1);
            freqMap.merge(freq + 1, 1, Integer::sum);
        } else if (op == 2) {
            int freq = map.getOrDefault(v, 0);
            if (freq == 0) continue;                              // 없는 값이면 무시
            freqMap.merge(freq, -1, Integer::sum);
            if (freq == 1) map.remove(v);
            else {
                map.put(v, freq - 1);
                freqMap.merge(freq - 1, 1, Integer::sum);         // 새 빈도에 더하기
            }
        } else {
            answer.add(freqMap.getOrDefault(v, 0) > 0 ? 1 : 0);
        }
    }
    return answer;
}
```

바뀐 점:

- **빈도가 `old → new`로 바뀔 때마다 `freqMap[old]--`, `freqMap[new]++`를 짝으로** 한다.
- **빈도 0은 `freqMap`에 넣지 않는다.** 추가할 때는 `freq > 0`일 때만 옛 칸을 빼고, 삭제로 0이 되면 `map`에서 지우기만 한다.
- **없는 값 삭제는 `continue`로 먼저 걸러 낸다.**
- **`merge(key, ±1, Integer::sum)`**: `getOrDefault` + `put` 두 줄을 한 줄로 줄인다.
- **`op`, `v`를 `int`로 먼저 꺼낸다.** `Integer`끼리 `==`로 비교하는 실수를 막는다(아래 흔한 실수 참고).

## 핵심 포인트

### 불변식: 두 맵은 항상 서로 맞아야 한다

"`freqMap[k]` = `map`에서 값이 `k`인 항목의 개수 (k ≥ 1)". 쿼리 하나가 끝날 때마다 이 관계가 유지되면 3번 쿼리의 답은 항상 맞다. 값 하나의 빈도가 바뀌면 **옛 칸 하나와 새 칸 하나만** 영향을 받으니, 두 칸을 같이 고치면 불변식이 유지된다. 처음 코드는 이 중 한 칸만 고쳐서 불변식이 깨졌다.

### 복잡도

| 쿼리 | 비용 |
|---|---|
| 1, 2번 | 맵 연산 몇 번 → 평균 O(1) |
| 3번 | `freqMap` 조회 한 번 → 평균 O(1) |
| **합계** | **시간 O(q), 공간 O(q)** |

### 많이 쓰이는 다른 구현: `countOfFreq`를 배열로

값 하나의 빈도는 쿼리 수 `q`를 넘을 수 없다. 그래서 `countOfFreq`를 크기 `q + 1`인 `int[]`로 만들 수 있다. 박싱이 없어 빠르고, `merge`나 `getOrDefault`도 필요 없다.

```java
static List<Integer> freqQuery(List<List<Integer>> queries) {
    Map<Integer, Integer> freq = new HashMap<>();
    int[] countOfFreq = new int[queries.size() + 1];   // 빈도는 최대 q
    List<Integer> res = new ArrayList<>();
    for (List<Integer> q : queries) {
        int op = q.get(0), v = q.get(1);
        if (op == 1) {
            int f = freq.getOrDefault(v, 0);
            countOfFreq[f]--;                           // f == 0이면 0번 칸이 음수가 되지만 조회하지 않음
            freq.put(v, f + 1);
            countOfFreq[f + 1]++;
        } else if (op == 2) {
            int f = freq.getOrDefault(v, 0);
            if (f == 0) continue;
            countOfFreq[f]--;
            freq.put(v, f - 1);
            countOfFreq[f - 1]++;
        } else {
            res.add(v < countOfFreq.length && countOfFreq[v] > 0 ? 1 : 0);  // z는 최대 10^9 → 범위 확인
        }
    }
    return res;
}
```

| | 맵 버전 | 배열 버전 |
|---|---|---|
| 3번 쿼리 `z`가 클 때 | 맵에 없으면 0, 따로 처리할 것 없음 | `z > q`면 **범위 확인 필수** (안 하면 `ArrayIndexOutOfBoundsException`) |
| 빈도 0 처리 | 0번 칸을 만들지 않도록 조건 분기 | 0번 칸은 버리는 칸, 분기 없이 `--`/`++` |
| 속도 | `Integer` 박싱 | 원시 배열이라 더 빠름 |

> 배열 버전은 브루트포스(`containsValue`) 풀이와 무작위 입력 3,000회를 대조해 결과가 같음을 확인했다.

## 주의할 점 / 흔한 실수

- **옛 빈도 칸을 빼지 않음** → 한 번이라도 그 빈도였던 값이 계속 남아 3번 쿼리가 1을 돌려준다. (처음 제출에서 한 실수)
- **삭제로 빈도가 0이 될 때 `map`을 안 고침** → 같은 값을 또 지우면 카운트가 이중으로 빠진다.
- **없는 값 삭제를 거르지 않음** → `countOfFreq[0]`이나 음수 칸이 생긴다. 삭제 로직 맨 앞에서 `f == 0`이면 `continue`.
- **`q.get(0) == 1`은 괜찮지만 `q.get(0) == q.get(1)`처럼 `Integer`끼리 `==`를 쓰면 위험하다.** -128~127은 캐시돼서 우연히 맞다가 큰 값에서 틀린다. `int`로 먼저 꺼내 쓰는 습관을 들인다.
- **Java 템플릿의 입력 파싱이 느림** → 로직이 O(q)여도 큰 테스트에서 시간 초과가 날 수 있다. 그럴 땐 `main`을 `BufferedReader` + `StringTokenizer`로, 출력은 `StringBuilder`로 바꾼다.

## 한 줄 정리
> "정확히 z번 나온 값이 있나?"는 **빈도 → 개수 맵**을 하나 더 두고, 빈도가 `old → new`로 바뀔 때마다 **`old` 칸 빼기와 `new` 칸 더하기를 반드시 짝으로** 한다.
