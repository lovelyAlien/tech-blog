---
date: 2026-10-01
lastmod: 2026-10-01
tags:
draft: false
---
# Java에서 Map을 순회하는 방법은?

알고리즘 문제에서 해시맵에 상태를 모아 두고 마지막에 한 번 훑는 패턴은 정말 자주 나온다. 그런데 Map은 `Iterable`이 아니라서 for-each를 바로 쓸 수 없다. 그래서 **세 가지 뷰**(`keySet`, `values`, `entrySet`) 중 하나를 꺼내서 돌거나, `forEach`나 스트림을 쓴다. 상황마다 어떤 방법이 맞는지와 돌면서 삭제할 때의 함정을 정리해두자.

예시는 `Map<Integer, Integer> expiry` (token_id → 만료 시각) 기준이다. ([[Authentication Tokens]] 문제에서 나온 코드)

## 1. `values()`: 값만 필요할 때

```java
for (int exp : expiry.values()) {
    if (exp >= lastTime) count++;
}
```

키가 필요 없을 때 가장 간단하다.

## 2. `keySet()`: 키만 필요할 때

```java
for (int id : expiry.keySet()) {
    System.out.println(id);
}
```

키로 돌면서 `get(id)`로 값을 꺼내면 조회를 매번 한 번 더 한다. 키와 값이 둘 다 필요하면 `entrySet()`을 쓰자.

```java
// ❌ 조회가 매번 한 번 더 일어남
for (int id : expiry.keySet()) {
    int exp = expiry.get(id);
}

// ✅ 엔트리에서 바로 꺼냄
for (var e : expiry.entrySet()) {
    int exp = e.getValue();
}
```

## 3. `entrySet()`: 키와 값이 둘 다 필요할 때 (가장 많이 씀)

```java
for (Map.Entry<Integer, Integer> e : expiry.entrySet()) {
    int id = e.getKey();
    int exp = e.getValue();
    if (exp >= lastTime) System.out.println(id + " 유효");
}
```

- `Map.Entry<...>`가 길면 `var`로 줄일 수 있다(Java 10+): `for (var e : expiry.entrySet())`
- 돌면서 값을 바꿀 수도 있다: `e.setValue(e.getValue() + 1);`

## 4. `forEach` + 람다 (Java 8+)

```java
expiry.forEach((id, exp) -> System.out.println(id + " → " + exp));
```

코드는 가장 짧다. 다만 람다 안에서는 바깥 지역 변수를 바꿀 수 없다. 람다는 effectively final인 변수만 캡처할 수 있기 때문이다. 그래서 개수 세기 같은 집계에는 맞지 않는다.

```java
int count = 0;
expiry.forEach((id, exp) -> { if (exp >= lastTime) count++; });  // ❌ 컴파일 에러
```

## 5. 스트림: 집계, 필터링, 변환

```java
long count = expiry.values().stream()
        .filter(exp -> exp >= lastTime)
        .count();

List<Integer> validIds = expiry.entrySet().stream()
        .filter(e -> e.getValue() >= lastTime)
        .map(Map.Entry::getKey)
        .toList();
```

`forEach` 람다로는 못 하던 개수 세기도 스트림으로는 깔끔하게 할 수 있다.

## 6. 돌면서 삭제하기: `Iterator` 또는 `removeIf`

for-each 안에서 `map.remove()`를 호출하면 **`ConcurrentModificationException`**이 발생한다. 맵 구조가 바뀌면 반복자가 이를 감지하고(fail-fast) 바로 예외를 던지기 때문이다.

```java
// ❌ ConcurrentModificationException
for (int id : expiry.keySet()) {
    if (expiry.get(id) < lastTime) expiry.remove(id);
}

// ✅ Iterator.remove()
Iterator<Map.Entry<Integer, Integer>> it = expiry.entrySet().iterator();
while (it.hasNext()) {
    if (it.next().getValue() < lastTime) it.remove();
}

// ✅ removeIf (Java 8+, 가장 간단)
expiry.values().removeIf(exp -> exp < lastTime);
```

세 뷰는 복사본이 아니라 **원본 맵과 연결된 뷰**다. 그래서 뷰에서 지우면 원본 맵에서도 지워진다.

## 7. 값을 한꺼번에 바꾸기: `replaceAll`

```java
expiry.replaceAll((id, exp) -> exp + 10);   // 모든 만료 시각을 10씩 연장
```

## 언제 무엇을 쓰나

| 필요한 것 | 추천 |
|---|---|
| 값만 | `values()` |
| 키만 | `keySet()` |
| 키 + 값 | `entrySet()` |
| 단순 출력/처리 | `forEach((k, v) -> ...)` |
| 개수 세기, 필터링, 변환 | 스트림 |
| 돌면서 삭제 | `removeIf` / `Iterator.remove()` |
| 모든 값 변경 | `replaceAll` |

**순회 순서**: `HashMap`은 순서를 보장하지 않는다. 넣은 순서가 필요하면 `LinkedHashMap`, 키 정렬 순서가 필요하면 `TreeMap`을 쓴다.

## 한 줄 정리
> Map은 `values`/`keySet`/`entrySet` 뷰로 순회하고, 키와 값이 둘 다 필요하면 `entrySet`을 쓴다. 돌면서 삭제할 때는 `remove()` 대신 `removeIf`나 `Iterator.remove()`를 쓴다.
