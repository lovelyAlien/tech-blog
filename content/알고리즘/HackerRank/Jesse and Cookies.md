---
date: 2026-09-23
lastmod: 2026-09-23
tags:
draft: false
---
# Jesse and Cookies: 최소 힙으로 "가장 작은 두 개" 반복 합치기, 그리고 int 오버플로

"가장 작은 것 두 개를 꺼내 합치고 다시 넣기"가 반복되는 전형적인 최소 힙 문제. 처음 짠 코드는 예제와 무작위 테스트를 다 통과했지만, 값이 커지면 `int` 오버플로로 틀린다. 코드 흐름도 한 번 다듬었고, 그 과정을 같이 정리해 둔다.

- 문제: [HackerRank - Jesse and Cookies](https://www.hackerrank.com/challenges/jesse-and-cookies/problem)

## 문제 요약

- 쿠키의 단맛 배열 `A`와 목표값 `k`가 주어진다.
- 모든 쿠키의 단맛이 `k` 이상이 될 때까지, **가장 덜 단 쿠키 `a`와 두 번째로 덜 단 쿠키 `b`를 합쳐 단맛이 `a + 2 × b`인 쿠키 하나로** 바꾼다.
- 필요한 최소 합치기 횟수를 반환하고, 불가능하면 `-1`을 반환한다.

```
k = 7, A = [1, 2, 3, 9, 10, 12]  →  2
   1과 2 합침 → 1 + 2*2 = 5   →  [3, 5, 9, 10, 12]
   3과 5 합침 → 3 + 2*5 = 13  →  [9, 10, 12, 13]   (모두 >= 7)

k = 100, A = [1, 2]  →  -1   (한 번 합쳐 5가 되면 더 합칠 짝이 없음)
k = 1,   A = [5, 6]  →  0    (처음부터 모두 k 이상)
```

## 접근: 매번 정렬하지 말고 최소 힙

매 단계마다 "가장 작은 값 두 개"가 필요하다. 합치면 새 값이 생기니까 순서가 계속 바뀐다.

- **매번 정렬**: 정렬 O(n log n)을 최대 n번 → O(n² log n). 시간 초과.
- **최소 힙 (`PriorityQueue`)**: 최솟값 확인 `peek()` O(1), 꺼내기 `poll()`과 넣기 `offer()`가 O(log n). 합치기는 최대 n-1번 → **O(n log n)**.

종료 조건은 세 가지다.
1. **힙의 최솟값 ≥ k** → 지금까지 센 횟수를 반환
2. **남은 쿠키가 1개 이하**인데 최솟값 < k → 더 합칠 짝이 없으니 `-1`
3. 그 외 → 두 개 꺼내 합치고 다시 넣기, 횟수 +1

## 처음 작성한 코드

```java
public static int cookies(int k, List<Integer> A) {
    PriorityQueue<Integer> heap = new PriorityQueue<>();
    int cnt = 0;

    for (int i = 0; i < A.size(); i++) {
        heap.offer(A.get(i));
    }

    while (!heap.isEmpty()) {
        int peeked = heap.peek();
        heap.poll();
        if (peeked >= k) break;

        if (heap.isEmpty()) return -1;

        int sweetness = peeked + 2 * heap.peek();   // 여기서 오버플로 가능
        cnt++;
        heap.poll();
        heap.offer(sweetness);
    }

    return cnt;
}
```

로직 자체는 맞다. 최솟값을 먼저 꺼내 k와 비교하고, 힙이 비었는지 확인한 **다음에** 두 번째 값을 보기 때문에 NPE도 나지 않는다. 예제와 작은 값 무작위 테스트 2,000회를 모두 통과했다.

### 문제 1: `int` 오버플로

```
k = 1,000,000,000,  A = [999,999,999, 999,999,999]
a + 2b = 999,999,999 + 1,999,999,998 = 2,999,999,997   ← int 최댓값(2,147,483,647) 초과
```

`int`로 계산하면 결과가 **-1,294,967,299**로 뒤집힌다. 이 음수가 힙의 최솟값이 되고, 짝이 없으니 `-1`을 반환한다. 정답은 `1`이다(한 번 합치면 k 이상).

HackerRank 원문 제약(원소 값이 작은 편)에서는 무작위 테스트로 재현되지 않아 제출하면 통과할 가능성이 높다. 하지만 라이브 코딩에서는 "합친 값이 int 범위를 넘을 수 있나요?"가 거의 반드시 나오는 꼬리 질문이다. **값을 더하거나 곱하는 코드를 쓰면 최대 범위부터 계산해 본다.**

### 문제 2: 읽기 어려운 흐름

- `peek()` 다음 줄에서 `poll()`을 또 부른다. `poll()`은 꺼낸 값을 **반환**하므로 한 번이면 된다.
- 조건이 `while (!heap.isEmpty())`인데, 실제로 루프는 `break`나 `return`으로만 끝난다. 이 조건이 거짓이 되는 건 빈 입력일 때뿐이고, 그때는 의미상 `-1`이어야 하는데 `0`을 반환한다.

## 개선한 풀이

```java
public static int cookies(int k, List<Integer> A) {
    PriorityQueue<Long> heap = new PriorityQueue<>();   // long: a + 2b 오버플로 방지
    for (int s : A) heap.offer((long) s);

    int cnt = 0;
    while (true) {
        if (heap.peek() >= k) return cnt;   // 최솟값이 k 이상이면 전부 k 이상
        if (heap.size() < 2) return -1;     // 합칠 짝이 없음
        long a = heap.poll();
        long b = heap.poll();
        heap.offer(a + 2 * b);
        cnt++;
    }
}
```

바뀐 점은 세 가지다.

- **`PriorityQueue<Long>`**: 합친 값을 `long`으로 저장한다. `2 * b`도 `b`가 `long`이라 `long` 연산으로 계산된다.
- **`poll()` 반환값 사용**: `long a = heap.poll();` 한 줄로 확인과 제거를 동시에 한다.
- **`while (true)` + 종료 조건 3개를 순서대로**: 루프가 어디서 끝나는지 위에서 아래로 읽힌다.

> 입력이 비어 있으면 `heap.peek()`이 `null`이라 NPE가 난다. HackerRank는 n ≥ 1이라 괜찮지만, 라이브에서는 "빈 입력은 제약상 없다고 가정하겠습니다"라고 한마디 해 둔다.

## 핵심 포인트

### 왜 최솟값 하나만 보면 되나

힙의 최솟값이 `k` 이상이면, 나머지 원소는 모두 그보다 크거나 같으니 **전부 `k` 이상**이다. "모든 원소가 k 이상인지"를 매번 O(n)으로 확인할 필요가 없고, O(1)의 `peek()` 한 번으로 끝난다.

### 복잡도

| 단계 | 비용 |
|---|---|
| 힙 구성 (`offer` n번) | O(n log n) |
| 합치기 최대 n-1번 × (`poll` 2번 + `offer` 1번) | O(n log n) |
| **합계** | **시간 O(n log n), 공간 O(n)** |

한 번 합칠 때마다 쿠키가 1개씩 줄어드므로 합치기는 최대 n-1번이다.

### 힙 구성을 O(n)으로: heapify

`new PriorityQueue<>(collection)`처럼 컬렉션을 통째로 넘기면 내부적으로 heapify가 돌아 **O(n)**에 힙을 만든다(하나씩 `offer`하면 O(n log n)). 이 문제에선 `Integer` → `Long` 변환이 필요해서 `offer` 반복을 썼다. 합치기 단계가 어차피 O(n log n)이라 전체 복잡도는 같지만, "힙 초기화를 더 빠르게 할 수 있나요?" 같은 꼬리 질문에서 쓸 수 있다.

```java
// Integer 그대로 쓸 수 있는 경우라면
PriorityQueue<Integer> heap = new PriorityQueue<>(A);   // O(n) heapify
```

## 주의할 점 / 흔한 실수

- **`a + 2 * b`를 `int`로 계산** → 10억에 가까운 값 두 개만 합쳐도 오버플로. 음수가 힙 최솟값으로 올라와 결과가 틀린다.
- **`poll()` 두 번 전에 `size() < 2` 확인 누락** → `PriorityQueue<Long>`에서 `poll()`이 `null`을 반환하고, `long`으로 언박싱하다 NPE가 난다.
- **종료 조건을 "모든 원소 확인"으로 구현** → 반복마다 O(n)이 추가돼 전체 O(n²).
- **`PriorityQueue`를 `toString()`이나 for-each로 찍어 보고 정렬됐다고 착각** → 내부 배열 순서일 뿐이다. 정렬 순서가 필요하면 `poll()`을 반복한다.

## 한 줄 정리
> "가장 작은 것 두 개를 꺼내 합치기"가 반복되면 최소 힙을 쓰고, 최솟값 하나만 보고 종료를 판단한다. 값을 합치거나 곱해서 다시 넣는 문제는 **최대 범위부터 계산해 보고 `long`**을 쓴다.
