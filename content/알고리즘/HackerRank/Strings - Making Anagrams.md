---
date: 2026-09-30
lastmod: 2026-09-30
tags:
draft: false
---
# Strings: Making Anagrams — 알파벳별 개수 차이만큼 지운다

두 문자열이 애너그램이 되려면 **알파벳별 개수가 같아야** 한다. 그러니 문자마다 개수 차이만큼 지우면 되고, 그 차이의 합이 답이다. 제출한 `HashMap` 두 개 풀이는 정답이었다. 다만 입력이 소문자뿐이라 **`int[26]` 배열 하나**로 더 짧게 줄일 수 있어서 같이 정리해 둔다.

- 문제: [HackerRank - Strings: Making Anagrams](https://www.hackerrank.com/challenges/ctci-making-anagrams/problem)

## 문제 요약

문자열 `a`, `b`가 주어진다. 두 문자열에서 문자를 지워서 서로 애너그램(문자 구성이 같은 문자열)으로 만들 때, **지워야 하는 문자의 최소 개수**를 반환한다.

- 두 문자열 모두 **소문자 a~z**로만 이뤄진다.
- 순서는 상관없고 개수만 맞으면 된다.

```
a = "cde", b = "abc" → 4
  공통: c (각 1개)          → 지울 것 없음
  a에만: d, e               → 2개 지움
  b에만: a, b               → 2개 지움
```

## 접근 (핵심 아이디어)

- **브루트포스**: `a`의 문자마다 `b`에서 같은 문자를 찾아 짝지어 지우면 O(n·m).
- **관점 전환**: 어떤 문자를 짝지을지는 중요하지 않다. **문자별 개수**만 알면 된다.
  - `a`에 c가 3개, `b`에 c가 1개면 c는 **|3 − 1| = 2개**를 지워야 한다.
  - 한쪽에만 있는 문자는 상대 개수가 0이라, 같은 식으로 그 개수 전부를 지운다.
- 그래서 **답 = Σ |a의 개수 − b의 개수|** (모든 알파벳에 대해). 개수 세기는 한 번씩 훑으면 되니 O(n + m).

## 제출한 풀이

```java
public static int makeAnagram(String a, String b) {
    int answer = 0;

    Map<Character, Integer> aFreqMap = new HashMap<>();
    Map<Character, Integer> bFreqMap = new HashMap<>();

    for (int i = 0; i < a.length(); i++) {
        Character ac = a.charAt(i);
        aFreqMap.put(ac, aFreqMap.getOrDefault(ac, 0) + 1);
    }

    for (int i = 0; i < b.length(); i++) {
        Character bc = b.charAt(i);
        bFreqMap.put(bc, bFreqMap.getOrDefault(bc, 0) + 1);
    }

    // a에 있는 문자: 두 문자열의 개수 차이만큼 지운다 (b에 없으면 bCount = 0)
    for (Map.Entry<Character, Integer> entry : aFreqMap.entrySet()) {
        char key = entry.getKey();
        int aCount = entry.getValue();
        int bCount = bFreqMap.getOrDefault(key, 0);

        answer += Math.abs(aCount - bCount);

        bFreqMap.remove(key);   // 계산한 문자는 b에서 제거 → 두 번 세지 않도록
    }

    // b에만 있는 문자: a에 하나도 없으니 전부 지운다
    for (int bCount : bFreqMap.values()) {
        answer += bCount;
    }

    return answer;
}
```

잘한 점:

- **"b에만 있는 문자"를 빠뜨리지 않았다.** `a` 기준으로만 돌면 `b`에만 있는 문자를 놓친다. 계산한 키를 `bFreqMap`에서 지우고, 남은 값을 마지막에 더해서 해결했다.
- **순회 중인 맵은 건드리지 않았다.** `aFreqMap`을 순회하면서 지우는 건 `bFreqMap`이라 `ConcurrentModificationException`이 나지 않는다.

## 핵심 포인트

### 개수 차이의 절댓값 합이 곧 최솟값인 이유

알파벳마다 독립적이다. c를 몇 개 지우든 d의 개수에는 영향이 없다. 그래서 알파벳별로 따로 최솟값을 구해 더하면 된다. 한 알파벳에 대해서는 적은 쪽 개수에 맞춰 많은 쪽을 줄이는 게 최소고, 그 값이 `|x − y|`다.

### `int[26]` 배열 하나로 줄이기

소문자만 나온다는 조건이 있으면 `HashMap`보다 배열이 낫다.

```java
public static int makeAnagram(String a, String b) {
    int[] diff = new int[26];                          // 알파벳별 (a 개수 − b 개수)

    for (char c : a.toCharArray()) diff[c - 'a']++;    // a에 있으면 +1
    for (char c : b.toCharArray()) diff[c - 'a']--;    // b에 있으면 −1

    int answer = 0;
    for (int d : diff) answer += Math.abs(d);          // 차이의 절댓값 = 지울 개수
    return answer;
}
```

| | HashMap 두 개 (제출) | `int[26]` 하나 |
|---|---|---|
| 시간 | O(n + m), 해싱·박싱 비용 있음 | O(n + m), 배열 인덱스 접근 |
| 공간 | O(1) (키 최대 26개) + 객체 오버헤드 | O(1), 정수 26개 |
| "b에만 있는 문자" 처리 | 따로 `remove` + 남은 값 합산 | `+1`/`−1`로 한 배열에 모으면 자동 처리 |
| 쓸 수 있는 입력 | 아무 문자 | 문자 범위가 작을 때만 |

`c - 'a'`는 `'a'`를 0, `'z'`를 25로 바꾸는 인덱스 계산이다. `a`는 더하고 `b`는 빼서 배열 하나에 **차이**를 바로 모으는 게 핵심이다.

두 풀이를 무작위 입력 5000쌍으로 비교해 결과가 같음을 확인했다.

## 주의할 점 / 흔한 실수

- **`a` 기준으로만 계산** → `b`에만 있는 문자를 빠뜨린다. `abc`와 `abcdd`에서 d 2개를 놓친다.
- **공통 문자 개수를 세서 빼는 방식에서 실수** → `n + m − 2 × 공통 개수`도 맞는 식이지만, 공통 개수를 `min(aCount, bCount)`가 아니라 존재 여부(Set)로 세면 틀린다.
- **`Character ac = a.charAt(i)`** → 동작은 같지만 괜히 박싱한다. `char`로 받으면 `put`할 때 알아서 박싱된다.
- **소문자 조건 확인 없이 `int[26]` 사용** → 대문자나 공백이 들어오면 `c - 'a'`가 범위를 벗어나 `ArrayIndexOutOfBoundsException`. 조건이 없으면 `int[128]`이나 `HashMap`을 쓴다.

## 한 줄 정리
> 애너그램은 **알파벳별 개수가 같으면** 된다. `a`는 `+1`, `b`는 `−1`로 **`int[26]`에 차이를 모으고 절댓값을 더하면** 답이다.
