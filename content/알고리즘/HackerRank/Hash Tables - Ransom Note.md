---
date: 2026-09-30
lastmod: 2026-09-30
tags:
draft: false
---
# Hash Tables: Ransom Note — 잡지 단어를 세고 쪽지 단어만큼 차감한다

잡지 단어를 `HashMap`으로 세 두고, 쪽지 단어를 하나씩 **차감**하다가 0인 단어를 만나면 `No`를 출력한다. 처음 제출한 코드는 로직은 맞았다. 그런데 **`if`에 중괄호가 없어서** `return`이 항상 실행됐고, 그래서 틀렸다. 그 과정을 같이 정리해 둔다.

- 문제: [HackerRank - Hash Tables: Ransom Note](https://www.hackerrank.com/challenges/ctci-ransom-note/problem)

## 문제 요약

잡지(`magazine`)에서 단어를 통째로 오려 붙여 쪽지(`note`)를 만들 수 있는지 판단한다.

- 단어 하나는 **한 번만** 쓸 수 있다. 쪽지에 같은 단어가 두 번 나오면 잡지에도 두 번 이상 있어야 한다.
- **대소문자를 구분**한다 (`Give` ≠ `give`).
- 만들 수 있으면 `Yes`, 없으면 `No`를 **출력**한다 (반환값 없음).
- `m, n ≤ 30,000`, 단어 길이 ≤ 5

```
magazine: give me one grand today night
note:     give one grand today          → Yes

magazine: two times three is not four
note:     two times two is four         → No  ("two"가 잡지에 1개뿐)
```

## 접근: 잡지 빈도를 세고 쪽지로 차감

- **브루트포스**: 쪽지 단어마다 잡지 리스트에서 찾아 지우면 `List.remove`가 O(m)이라 전체 **O(m·n) ≈ 9×10^8**. 시간 초과 위험이 있다.
- **해시맵 카운팅**: 잡지 단어 빈도를 맵에 한 번 세 두면 쪽지 단어 하나는 평균 O(1)에 확인하고 차감할 수 있다. 전체 **O(m + n)**.

## 처음 제출한 코드 (오답)

```java
public static void checkMagazine(List<String> magazine, List<String> note) {
    Map<String, Integer> magazineFreq = new HashMap<>();
    Map<String, Integer> noteFreq = new HashMap<>();

    for (String m : magazine) {
        magazineFreq.put(m, magazineFreq.getOrDefault(m, 0) + 1);
    }
    for (String n : note) {
        noteFreq.put(n, noteFreq.getOrDefault(n, 0) + 1);
    }
    for (String n : note) {
        if (!magazineFreq.containsKey(n) || magazineFreq.get(n) < noteFreq.get(n))
            System.out.println("No");
            return;   // ❌ if 블록 밖 — 항상 실행됨
    }
    System.out.println("Yes");
}
```

### 버그: 중괄호 없는 `if`는 다음 한 문장만 감싼다

Java에서 들여쓰기는 아무 의미가 없다. 컴파일러가 보는 코드는 이렇다.

```java
for (String n : note) {
    if (조건) System.out.println("No");
    return;   // 첫 반복에서 무조건 종료
}
```

- 첫 쪽지 단어가 **부족하면** → `No` 출력 후 종료. 우연히 맞는다.
- 첫 쪽지 단어가 **충분하면** → **아무것도 출력하지 않고** 종료한다. `Yes`여야 하는 케이스가 전부 틀리고, 둘째 단어부터는 검사도 하지 않는다.

```
magazine: give me one grand today night
note:     give one grand today
→ 기대 "Yes", 실제 출력 없음
```

**수정**: 여러 문장을 조건에 묶을 땐 반드시 중괄호를 쓴다.

```java
if (!magazineFreq.containsKey(n) || magazineFreq.get(n) < noteFreq.get(n)) {
    System.out.println("No");
    return;
}
```

## 개선한 풀이

중괄호만 고쳐도 통과한다. 그런데 `noteFreq` 맵 없이 **잡지 카운트를 차감**하면 맵 하나, 쪽지 순회 한 번으로 끝난다.

```java
public static void checkMagazine(List<String> magazine, List<String> note) {
    Map<String, Integer> freq = new HashMap<>();
    for (String m : magazine) {
        freq.merge(m, 1, Integer::sum);
    }
    for (String n : note) {
        int cnt = freq.getOrDefault(n, 0);
        if (cnt == 0) {
            System.out.println("No");
            return;
        }
        freq.put(n, cnt - 1);
    }
    System.out.println("Yes");
}
```

바뀐 점:

- **맵이 두 개에서 하나로**: 쪽지 빈도를 따로 세서 비교하지 않고, 쪽지 단어를 쓸 때마다 잡지 재고를 1씩 줄인다. 재고가 0인데 또 필요하면 바로 `No`.
- **`containsKey` + `get` 대신 `getOrDefault(n, 0)`**: 없는 단어와 다 쓴 단어를 `cnt == 0` 하나로 처리한다.
- **`merge(m, 1, Integer::sum)`**: `put(m, getOrDefault(m, 0) + 1)`을 한 줄로 줄인다.
- **조기 종료**: 부족한 단어를 처음 만나는 즉시 끝난다.

## 핵심 포인트

### "재고 차감" 패턴

"A의 원소로 B를 만들 수 있나?" 류의 문제(Ransom Note, 애너그램 판별 등)는 **A의 빈도를 세고 B를 순회하며 차감**하는 형태가 가장 간결하다. B의 빈도를 따로 세서 두 맵을 비교하는 것과 결과는 같지만 맵 하나와 순회 한 번이 줄어든다.

### 복잡도

| 단계 | 비용 |
|---|---|
| 잡지 빈도 세기 | O(m) |
| 쪽지 차감 | O(n), 조회·갱신 평균 O(1) |
| **합계** | **시간 O(m + n), 공간 O(m)** |

## 주의할 점 / 흔한 실수

- **중괄호 없는 `if` 뒤에 두 문장** → 두 번째 문장은 조건과 무관하게 실행된다. (처음 제출에서 한 실수) 한 줄짜리 `if`라도 중괄호를 붙이는 습관을 들인다.
- **`Set`으로 존재 여부만 확인** → 같은 단어가 쪽지에 여러 번 나오는 경우를 놓친다. 개수까지 세야 한다.
- **대소문자 정규화(`toLowerCase`)** → 이 문제는 대소문자를 구분하므로 하면 안 된다. `HashMap<String, …>`은 기본으로 구분한다.
- **`Map.get()` 결과를 바로 `int`로 비교** → 키가 없으면 `null` 언박싱으로 `NullPointerException`. `getOrDefault`를 쓴다.

## 한 줄 정리
> 잡지 단어 빈도를 **HashMap으로 세고, 쪽지 단어마다 1씩 차감**하다가 0이면 `No`. 여러 문장을 조건에 묶을 땐 **반드시 중괄호**.
