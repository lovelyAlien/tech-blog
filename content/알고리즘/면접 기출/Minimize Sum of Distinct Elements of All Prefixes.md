---
date: 2026-10-01
lastmod: 2026-10-01
tags:
draft: false
---
# Minimize Sum of Distinct Elements of All Prefixes: 빈도 높은 원소부터 몰아서 배치

배열을 재배치해서 "각 prefix의 서로 다른 원소 수"의 합을 최소화하는 문제다. 결국 **빈도 내림차순 그리디**로 풀린다.

- 출처: 실제 라이브코딩 면접에서 출제된 문제 (HackerRank 환경)
- 공개된 동일 문제: [GeeksforGeeks - Minimize sum of distinct elements of all prefixes by rearranging array](https://geeksforgeeks.org/minimize-sum-of-distinct-elements-of-all-prefixes-by-rearranging-array)

## 문제 요약

배열을 원하는 순서로 재배치할 수 있다. 앞에서부터 원소를 하나씩 붙여 가며 각 prefix의 **서로 다른 원소 개수**를 구하고, 그 합의 최솟값을 반환한다.

```
arr = {1, 2, 1, 2, 1, 3}  →  재배치 {1, 1, 1, 2, 2, 3}

{1}             → 1
{1,1}           → 1
{1,1,1}         → 1
{1,1,1,2}       → 2
{1,1,1,2,2}     → 2
{1,1,1,2,2,3}   → 3
                  합 = 10
```

## 접근 (핵심 아이디어)

브루트포스는 모든 순열을 다 만들어 보는 것이라 O(n!·n)이다.

관점을 바꿔 보면, prefix의 서로 다른 원소 수는 **새 원소가 처음 등장할 때만 1 늘어난다.** 그러니 새 값은 최대한 늦게 등장시키고, 이미 나온 값을 최대한 많이 반복해서 붙이면 된다.

- 같은 값은 한 덩어리로 붙인다. 중간에 다른 값이 끼면 distinct가 일찍 오른다.
- 덩어리 순서는 **빈도가 큰 것부터** 둔다. 큰 덩어리가 낮은 distinct 값(1, 2, …)을 받게 된다.

i번째 덩어리(0부터 시작)의 원소들은 각각 `i+1`을 기여하므로 정답은 `Σ count[i] × (i+1)`이다. 이때 count는 빈도 내림차순으로 정렬한 값이다.

## 제출한 풀이

```java
static long minPrefixDistinctSum(int[] arr) {
    Map<Integer, Integer> freq = new HashMap<>();
    for (int x : arr) freq.merge(x, 1, Integer::sum);

    List<Integer> counts = new ArrayList<>(freq.values());
    counts.sort(Comparator.reverseOrder());

    long sum = 0;
    for (int i = 0; i < counts.size(); i++) {
        sum += (long) counts.get(i) * (i + 1);
    }
    return sum;
}
```

시간 복잡도는 O(n + k log k)이고, 공간 복잡도는 O(k)다. k는 서로 다른 원소의 개수다.

## 핵심 포인트

**왜 빈도 내림차순이 최적인가 (교환 논증)**

덩어리 크기가 a, b(a < b)인 두 그룹이 이 순서로 붙어 있고, 앞 그룹이 distinct 값 d를 받는다고 하자.

- a를 앞에 두면: `a·d + b·(d+1)`
- b를 앞에 두면: `b·d + a·(d+1)`
- 차이는 `(a·d + b·d + b) − (b·d + a·d + a) = b − a > 0`

그래서 큰 덩어리를 앞에 두는 쪽이 항상 작거나 같다. 인접한 쌍을 계속 이렇게 바꾸면 빈도 내림차순이 최적이 된다.

**손 추적**: `{3, 3, 2, 2, 3}`

```
freq = {3:3, 2:2}  →  counts 내림차순 [3, 2]
sum = 3×1 + 2×2 = 7      (배치: 3,3,3,2,2 → 1,1,1,2,2)
```

## 주의할 점 / 흔한 실수

- **값 기준 정렬로 착각하기 쉽다.** 첫 예시 `{1,2,1,2,1,3}`은 값 오름차순 결과가 빈도 내림차순 결과와 우연히 같아서 "정렬하고 각 prefix의 최댓값을 더한다"로 오해하기 쉽다. `{3,3,2,2,3}`을 값 오름차순으로 배치하면 `{2,2,3,3,3}` → 1+1+2+2+2 = **8**이 나와 오답이다(정답 7).
- 결과가 int 범위를 넘을 수 있다. n이 크고 원소가 모두 다르면 합이 n(n+1)/2이므로 `long`으로 누적한다.
- 실제 배열을 재배치해서 시뮬레이션할 필요는 없다. 빈도 배열만 있으면 된다.

## 한 줄 정리
> distinct는 새 값이 처음 나올 때만 오른다. 그래서 빈도 큰 값부터 덩어리로 붙이고 `Σ count[i]×(i+1)`을 구하면 된다.
