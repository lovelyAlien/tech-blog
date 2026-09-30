---
date: 2026-09-30
lastmod: 2026-09-30
tags:
draft: false
---
# Two Strings — 공통 문자가 하나라도 있으면 YES

공통 **부분 문자열**이 있는지 묻는 문제다. 그런데 길이 1짜리 문자도 부분 문자열이라서, 결국 **공통 문자가 하나라도 있는지**만 확인하면 된다. 제출한 `int[26]` 두 개 풀이는 정답이었다. 다만 **채우기만 하고 쓰지 않는 배열**이 하나 있어서, `boolean[26]` 하나로 줄인 풀이를 같이 정리해 둔다.

- 문제: [HackerRank - Two Strings](https://www.hackerrank.com/challenges/two-strings/problem)

## 문제 요약

문자열 `s1`, `s2`가 주어진다. 두 문자열에 **공통 부분 문자열**이 있으면 `YES`, 없으면 `NO`를 반환한다.

- 두 문자열 모두 **소문자 a~z**로만 이뤄진다.
- 길이는 최대 10^5.

```
s1 = "hello", s2 = "world" → YES  ("o", "l" 공통)
s1 = "hi",    s2 = "world" → NO
```

## 접근 (핵심 아이디어)

- **브루트포스**: 부분 문자열을 모두 만들어 비교하면 O(n²·m²) 이상이다. 길이 10^5에서는 불가능하다.
- **관점 전환**: 공통 부분 문자열이 있다면 그 안의 **문자 하나**도 두 문자열에 모두 들어 있다. 반대로 공통 문자가 하나 있으면 그 문자 자체가 길이 1짜리 공통 부분 문자열이다. 그러니 **"공통 부분 문자열이 있다" ⇔ "공통 문자가 있다"**.
- 문자가 26종뿐이니 **`s1`에 나온 문자를 표시**해 두고 `s2`에서 표시된 문자를 찾으면 O(n + m).

## 제출한 풀이

```java
public static String twoStrings(String s1, String s2) {
    int[] s1FreqMap = new int[26];
    int[] s2FreqMap = new int[26];

    for (int i = 0; i < s1.length(); i++) {
        Character c = s1.charAt(i);
        if (s1FreqMap[c - 'a'] == 0) s1FreqMap[c - 'a'] = 1;   // ❌ 채우지만 아래에서 안 씀
    }

    for (int i = 0; i < s2.length(); i++) {
        Character c = s2.charAt(i);
        if (s2FreqMap[c - 'a'] == 0) s2FreqMap[c - 'a'] = 1;
    }

    for (int i = 0; i < s1.length(); i++) {
        Character c = s1.charAt(i);
        if (s2FreqMap[c - 'a'] != 0) return "YES";   // s1을 훑으며 s2 표시만 확인
    }

    return "NO";
}
```

정답이고 복잡도도 O(n + m)으로 최적이다. 그런데 다듬을 점이 있다.

### 1. `s1FreqMap`이 쓰이지 않는다

마지막 루프는 **`s1` 문자열**을 훑으면서 `s2FreqMap`만 본다. 그래서 첫 번째 루프가 채운 `s1FreqMap`은 결과에 아무 영향이 없다. 두 가지 올바른 형태가 섞인 모양이다.

- **한쪽만 표시하고 다른 쪽 문자열을 훑는다** → 배열 1개, 루프 2개
- **양쪽 다 표시하고 26칸을 비교한다** → 배열 2개, 루프 3개

```java
// 양쪽 다 표시했다면 마지막 비교는 이래야 한다
for (int i = 0; i < 26; i++) {
    if (s1Seen[i] && s2Seen[i]) return "YES";
}
```

### 2. 이름과 타입이 용도와 맞지 않는다

- 개수를 세지 않고 **나왔는지만** 기록하므로 `FreqMap`이 아니라 `seen`이 맞다. 타입도 `int[]`보다 `boolean[]`이 의도를 드러낸다.
- `if (arr[i] == 0) arr[i] = 1;`의 조건은 필요 없다. 이미 1이어도 다시 1을 넣을 뿐이다. `seen[i] = true;`로 충분하다.

### 3. `Character` 대신 `char`

`Character c = s1.charAt(i);`는 반복마다 오토박싱이 일어난다. 동작은 같지만 기본형 `char`로 받는 게 관례다.

## 개선한 풀이

```java
public static String twoStrings(String s1, String s2) {
    boolean[] seen = new boolean[26];

    for (char c : s1.toCharArray()) {
        seen[c - 'a'] = true;              // s1에 나온 문자 표시
    }

    for (char c : s2.toCharArray()) {
        if (seen[c - 'a']) return "YES";   // s2에서 표시된 문자를 만나면 즉시 종료
    }

    return "NO";
}
```

바뀐 점:

- **배열 2개 → 1개, 루프 3개 → 2개**: `s1`을 표시하고 `s2`를 훑는다.
- **`int[] FreqMap` → `boolean[] seen`**: 존재 여부만 기록한다는 뜻이 드러난다.
- **불필요한 조건문 제거**: 바로 `true`를 대입한다.
- **`char` 사용**: 박싱이 없다.

## 핵심 포인트

### 부분 문자열 문제를 문자 문제로 줄이기

"공통 부분 문자열이 **있는가**"처럼 **존재 여부**만 묻는다면 가장 짧은 경우(길이 1)만 확인하면 된다. 가장 **긴** 공통 부분 문자열을 묻는 문제(LCS 계열, DP)와 헷갈리지 않도록 조심한다.

### 다른 일반적인 풀이

| 풀이 | 시간 | 특징 |
|---|---|---|
| `boolean[26]` 표시 (개선안) | O(n + m) | 소문자 조건을 활용한 가장 가벼운 방법 |
| `HashSet<Character>` | O(n + m) | 문자 범위 제한이 없을 때 쓴다. 박싱·해싱 비용이 있다 |
| 알파벳 26개마다 `s1.indexOf(ch) >= 0 && s2.indexOf(ch) >= 0` | O(26·(n + m)) | 코드가 가장 짧다. 역시 선형 |

### 복잡도

| 단계 | 비용 |
|---|---|
| `s1` 표시 | O(n) |
| `s2` 검사 | O(m), 조기 종료 가능 |
| **합계** | **시간 O(n + m), 공간 O(1)** (26칸 고정) |

## 주의할 점 / 흔한 실수

- **부분 문자열을 실제로 만들어 비교** → 길이 10^5에서 시간 초과. 문자 하나로 충분하다는 점을 먼저 떠올린다.
- **표시용 배열을 만들고 쓰지 않음** → 제출한 코드에서 한 실수다. 동작은 맞지만 읽는 사람이 "이 배열이 어디 쓰이지?"라며 헷갈린다. 마지막 루프가 어떤 배열을 읽는지 확인한다.
- **소문자 조건 확인 없이 `c - 'a'` 사용** → 대문자나 공백이 들어오면 `ArrayIndexOutOfBoundsException`. 조건이 없으면 `boolean[128]`이나 `HashSet`을 쓴다.
- **반환값 대소문자** → `"Yes"`가 아니라 `"YES"`/`"NO"`다.

## 한 줄 정리
> 공통 부분 문자열의 존재 여부 = **공통 문자의 존재 여부**. `s1` 문자를 **`boolean[26]`에 표시**하고 `s2`에서 표시된 문자를 찾으면 끝.
