---
date: 2026-09-26
lastmod: 2026-09-26
tags:
draft: false
---
# Luck Balance: 중요한 대회 중 큰 것 k개만 지는 그리디, 그리고 Comparator 방향

"질 수 있는 횟수가 k번으로 제한될 때 무엇을 질까"를 고르는 전형적인 정렬 + 그리디 문제다. 아이디어는 단순한데, 풀면서 **정렬 방향**, **`get(0)`/`get(1)` 혼동**, **`i <= k` off-by-one**, 자잘한 컴파일 에러까지 거의 모든 실수를 한 번씩 밟았다. 그 과정을 같이 정리해 둔다.

- 문제: [HackerRank - Luck Balance](https://www.hackerrank.com/challenges/luck-balance/problem)

## 문제 요약

- 대회 목록 `contests[i] = [L, T]`가 주어진다. `L`은 행운값, `T`는 중요도(1 = 중요, 0 = 안 중요)다.
- 대회에서 **지면 행운 +L**, **이기면 행운 −L**이다.
- 중요한 대회(T=1)는 **최대 k개까지만** 질 수 있다. 안 중요한 대회는 몇 개를 져도 된다.
- 얻을 수 있는 행운 합계의 최댓값을 반환한다.

```
k = 3
[5,1] [2,1] [1,1] [8,1] [10,0] [5,0]  →  29

  안 중요한 대회는 전부 진다:          +10 +5        = 15
  중요한 대회 [8,5,2,1] 중 큰 3개는 진다: +8 +5 +2      = 15
  남은 중요한 대회는 이긴다:            −1            = −1
  합계                                             = 29
```

## 접근 (핵심 아이디어)

모든 대회를 지면 행운이 최대지만, 중요한 대회는 k개까지만 질 수 있다. 그래서 문제는 **"중요한 대회 중 어떤 k개를 질 것인가"**로 좁혀진다.

- **안 중요한 대회**는 제한이 없으니 전부 진다(+L).
- **중요한 대회**는 L이 **큰 순서로 k개**를 진다(+L). 나머지는 어쩔 수 없이 이긴다(−L).

큰 값을 더하고 작은 값을 빼야 합이 최대가 되니, 정렬 후 앞에서 k개를 고르는 그리디로 충분하다. 부분집합을 전부 따져 볼 필요가 없다.

## 제출한 풀이

중요한 대회만 따로 리스트에 모아 내림차순 정렬하는 방식이다.

```java
public static int luckBalance(int k, List<List<Integer>> contests) {
    int answer = 0;
    List<Integer> important = new ArrayList<>();
    for (List<Integer> c : contests) {
        if (c.get(1) == 0) answer += c.get(0);   // 안 중요한 대회는 전부 진다
        else important.add(c.get(0));
    }

    important.sort(Collections.reverseOrder());   // L 내림차순

    for (int i = 0; i < important.size(); i++) {
        if (i < k) answer += important.get(i);   // 큰 L k개는 진다
        else answer -= important.get(i);         // 나머지는 이긴다
    }
    return answer;
}
```

## 핵심 포인트

### 왜 그리디가 맞나

중요한 대회 L값의 합을 `S`라 하고, 진 대회의 L 합을 `X`라 하면 중요한 대회에서 얻는 행운은 `X − (S − X) = 2X − S`다. `S`는 고정이니 **`X`를 최대화**하면 된다. k개 이하를 골라 합을 최대로 만드는 방법은 큰 것부터 k개를 고르는 것뿐이다(L ≥ 0이므로 k개를 꽉 채워 지는 게 항상 이득이다).

### 복잡도

| 단계 | 비용 |
|---|---|
| 분류 (한 번 순회) | O(n) |
| 중요한 대회 정렬 | O(m log m), m ≤ n |
| **합계** | **시간 O(n log n), 공간 O(n)** |

k번째로 큰 값만 알면 되니 크기 k짜리 최소 힙으로 O(n log k)도 가능하지만, n이 작아서 정렬로 충분하다.

### 리스트 하나를 통째로 정렬하는 방법: Comparator 방향

분리하지 않고 `contests` 자체를 정렬하려면 **T 내림차순, 그다음 L 내림차순**이어야 한다.

```java
contests.sort((o1, o2) ->
    o1.get(1).equals(o2.get(1))
        ? Integer.compare(o2.get(0), o1.get(0))   // T가 같으면 L 내림차순
        : Integer.compare(o2.get(1), o1.get(1))   // T가 다르면 T 내림차순
);
// → [8,1] [5,1] [2,1] [1,1] [10,0] [5,0]

for (int i = 0; i < contests.size(); i++) {
    int luck = contests.get(i).get(0);
    if (i < k || contests.get(i).get(1) == 0) answer += luck;
    else answer -= luck;
}
```

- `Integer.compare(o1, o2)`는 **오름차순**, `Integer.compare(o2, o1)`은 **내림차순**이다.
- 2차 기준을 `compare(o1.get(0), o2.get(0))`로 쓰면 `[1,1] [2,1] [5,1] [8,1] ...`이 되어 앞에서 k개를 고를 때 **가장 작은** L을 고르게 된다.
- `|| get(1) == 0` 조건 덕분에 k가 중요한 대회 수보다 커서 `i < k` 구간에 T=0 대회가 들어와도 결과가 맞는다. T=0은 어차피 항상 더하기 때문이다.

오름차순을 유지하고 싶다면, 앞쪽의 `중요한 대회 수 − k`개를 **이기는** 방식으로 뒤집으면 된다. 다만 중요한 대회 수를 세는 루프가 하나 더 필요하다.

## 주의할 점 / 흔한 실수

풀면서 실제로 겪은 것들이다.

- **`get(1)`과 `get(0)` 혼동**: `answer += contests.get(i).get(1)`은 L이 아니라 T(0 또는 1)를 더한다. `List<List<Integer>>`는 인덱스에 이름이 없으니 처음에 `int luck = c.get(0), important = c.get(1);`로 풀어 두면 실수가 줄어든다.
- **정렬 방향과 부호 방향 불일치**: L 오름차순으로 정렬해 놓고 앞에서 k개를 `−=` 하면 작은 것 k개를 이기는 셈이 된다. "앞쪽 k개 = 질 대회 = 더하기"가 되려면 L 내림차순이어야 한다.
- **`i <= k` off-by-one**: k+1개를 지게 된다. 샘플에서 29가 아니라 31이 나왔다. **"k개"는 항상 `i < k`**다.
- **T 오름차순으로 정렬**: 안 중요한 대회가 앞에 오면 `i < k` 구간을 T=0 대회가 차지한다. k 제한은 중요한 대회에만 걸린다.
- **`int answer;` 초기화 누락**: 지역 변수는 기본값이 없어 `+=`에서 컴파일 에러가 난다. 필드만 0으로 자동 초기화된다.
- **`Collection.reverseOrder()`**: `Collection`은 인터페이스다. `reverseOrder()`는 유틸리티 클래스 **`Collections`**(끝에 s)에 있다.
- **템플릿의 `}` 삭제**: HackerRank 템플릿에서 `class Result`를 닫는 중괄호를 지우면 `reached end of file while parsing`이 난다. 에러 위치가 파일 끝으로 찍혀서 원인을 찾기 어렵다.
- **`Integer` 비교는 `.equals()`**: Comparator에서 `o1.get(1) == o2.get(1)`은 참조 비교다. −128~127 캐시 범위에서만 우연히 맞는다. 반면 `c.get(1) == 0`은 한쪽이 기본형이라 언박싱되어 값으로 비교되므로 안전하다.

## 한 줄 정리
> 안 중요한 대회는 전부 지고, 중요한 대회는 **L 내림차순으로 정렬해 앞에서 k개(`i < k`)만 진다**. Comparator는 `compare(o2, o1)`이 내림차순이고, 정렬 방향과 더하기/빼기 방향이 맞는지 샘플로 손 추적해 확인한다.
