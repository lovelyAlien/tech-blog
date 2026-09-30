---
date: 2026-09-30
lastmod: 2026-09-30
tags:
draft: false
---
# Alternating Characters — 바로 앞 글자와 같으면 지운다

`A`와 `B`로만 된 문자열에서 **인접한 두 글자가 같지 않도록** 지워야 하는 최소 개수를 구하는 문제다. 결국 **앞 글자와 같은 글자의 개수**를 세면 된다. 제출한 풀이는 스택으로 "마지막으로 남긴 글자"를 들고 다니며 비교했고 정답이었다. 스택 없이 인접 비교만으로도 풀 수 있어서 같이 정리한다.

- 문제: [HackerRank - Alternating Characters](https://www.hackerrank.com/challenges/alternating-characters/problem)

## 문제 요약

`A`와 `B`로만 이뤄진 문자열 `s`가 주어진다. 글자를 0개 이상 지워서 **같은 글자가 연속으로 붙어 있지 않게** 만들 때, 지워야 하는 **최소 개수**를 반환한다.

- 쿼리(문자열)가 여러 개 주어지고, 각 문자열 길이는 최대 10^5.

```
"AAAA"     → 3   ("A"만 남김)
"ABABABAB" → 0   (이미 번갈아 나옴)
"AAABBB"   → 4   ("AB"만 남김)
```

## 접근 (핵심 아이디어)

- 같은 글자가 연속된 구간(예: `AAA`)에서는 **하나만 남기고** 나머지를 지워야 한다. 구간 길이가 k면 k − 1개를 지운다.
- 구간마다 k − 1을 더하는 것은, 글자를 앞에서부터 보면서 **바로 앞 글자와 같을 때마다 1씩 세는 것**과 같다.
- 한 번 훑으면 되니 O(n).

## 제출한 풀이

```java
public static int alternatingCharacters(String s) {
    int answer = 0;
    Stack<Character> stack = new Stack<>();
    char[] arr = s.toCharArray();
    for (int i = 0; i < arr.length; i++) {
        if (stack.isEmpty()) stack.add(arr[i]);
        else {
            char peeked = stack.peek();
            if (peeked == arr[i]) answer++;      // 마지막으로 남긴 글자와 같으면 지움
            else stack.add(arr[i]);              // 다르면 남김
        }
    }
    return answer;
}
```

스택 맨 위에는 항상 **마지막으로 남긴 글자**가 있다. 새 글자가 그것과 같으면 지우고(`answer++`), 다르면 남긴다(`push`). 예제 7개와 무작위 문자열 2만 개(단순 인접 비교 풀이와 대조)에서 결과가 모두 같았다.

## 핵심 포인트

### 스택 맨 위 = 바로 앞 글자

지운 글자는 스택 맨 위와 같은 글자였으니, 지운 뒤에도 "바로 앞 글자"와 "스택 맨 위"는 같은 글자다. 그래서 스택 비교는 결국 **`s[i]`와 `s[i-1]` 비교**와 같고, 스택 아래쪽 원소는 한 번도 쓰이지 않는다.

```
s = "AABAAB"
i=0 A  스택 비어 있음 → push        [A]
i=1 A  top A와 같음   → answer=1    [A]
i=2 B  top A와 다름   → push        [A, B]
i=3 A  top B와 다름   → push        [A, B, A]
i=4 A  top A와 같음   → answer=2    [A, B, A]
i=5 B  top A와 다름   → push        [A, B, A, B]
→ 2
```

### 스택 없이 인접 비교

맨 위 원소만 쓰니 스택 대신 인접 글자를 바로 비교하면 공간이 O(1)이 된다.

```java
public static int alternatingCharacters(String s) {
    int deletions = 0;
    for (int i = 1; i < s.length(); i++) {
        if (s.charAt(i) == s.charAt(i - 1)) deletions++;   // 앞 글자와 같으면 지워야 함
    }
    return deletions;
}
```

| | 제출(스택) | 인접 비교 |
|---|---|---|
| 시간 | O(n) | O(n) |
| 공간 | O(n) (스택 + `toCharArray`) | O(1) |
| 비고 | `Stack`은 동기화되는 레거시 클래스 | 인덱스 1부터 시작해 빈 문자열·한 글자도 자연히 처리 |

## 주의할 점 / 흔한 실수

- **`Stack` 클래스** → `Vector`를 상속한 레거시 클래스라 메서드마다 동기화 비용이 있다. 스택이 필요하면 `ArrayDeque`(`push`/`peek`/`pop`)를 쓴다. 이 문제는 스택 자체가 필요 없다.
- **`stack.add`** → `Stack`에서는 `push`와 같은 효과지만, `ArrayDeque`의 `add`는 **맨 뒤(addLast)** 에 넣고 `peek`은 맨 앞을 본다. 습관적으로 `add`를 쓰다 `ArrayDeque`로 바꾸면 틀린다. 스택 연산은 `push`로 통일한다.
- **인접 비교 반복문을 0부터 시작** → `s.charAt(i - 1)`에서 `i = 0`이면 범위를 벗어난다. 1부터 시작한다.
- **다른 글자끼리도 센다고 착각** → `ABAB`처럼 번갈아 나오면 0이다. 같은 글자가 **연속**일 때만 지운다.

## 한 줄 정리
> **앞 글자와 같은 글자 수**가 답이다. 스택 맨 위는 결국 바로 앞 글자라서, 스택 없이 `s[i] == s[i-1]`만 세면 O(n) 시간, O(1) 공간.
