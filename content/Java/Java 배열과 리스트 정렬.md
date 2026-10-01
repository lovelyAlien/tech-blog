---
date: 2026-10-01
lastmod: 2026-10-01
tags:
draft: false
---
# Java에서 배열과 리스트는 어떻게 정렬할까?

코딩 테스트든 실무든 정렬은 매일 쓰지만, `int[]`는 내림차순이 바로 안 되고 `List.of()`는 정렬하면 예외가 터지는 등 은근히 걸리는 함정이 많다. 기본 사용법과 함께 내부 알고리즘 차이까지 정리해두자.

## 배열 정렬: `Arrays.sort()`

```java
int[] nums = {5, 2, 9, 1};
Arrays.sort(nums);                              // 오름차순 → [1, 2, 5, 9]

String[] names = {"kim", "lee", "park"};
Arrays.sort(names);                             // 사전순
Arrays.sort(names, Comparator.reverseOrder());  // 내림차순
```

### 함정: 기본형 배열은 Comparator를 못 쓴다

`Arrays.sort(int[], Comparator)` 같은 오버로드는 없다. Comparator는 제네릭 `T`를 받는데, 제네릭은 기본형을 받을 수 없기 때문이다. 그래서 `int[]`를 내림차순으로 정렬하려면 박싱해야 한다.

```java
// ❌ 컴파일 에러
Arrays.sort(nums, Collections.reverseOrder());

// ✅ Integer[]로 선언
Integer[] boxed = {5, 2, 9, 1};
Arrays.sort(boxed, Collections.reverseOrder());

// ✅ int[]를 스트림으로 처리
int[] desc = Arrays.stream(nums).boxed()
        .sorted(Comparator.reverseOrder())
        .mapToInt(Integer::intValue).toArray();
```

## 리스트 정렬: `list.sort()`

```java
List<Integer> list = new ArrayList<>(List.of(5, 2, 9, 1));
list.sort(null);                        // 오름차순 (자연 순서)
list.sort(Comparator.reverseOrder());   // 내림차순
// Collections.sort(list); 도 같은 동작 (Java 8 이전 방식)
```

### 함정: 불변 리스트는 정렬할 수 없다

```java
// ❌ UnsupportedOperationException
List<Integer> immutable = List.of(5, 2, 9, 1);
immutable.sort(null);

// ✅ 가변 리스트로 감싸서 정렬
List<Integer> mutable = new ArrayList<>(List.of(5, 2, 9, 1));
mutable.sort(null);
```

`Arrays.asList(...)`는 원소 교체(`set`)는 되기 때문에 `sort`는 동작한다. 다만 크기를 바꾸는 `add`/`remove`는 안 된다.

## 객체를 특정 필드로 정렬: `Comparator.comparing`

```java
record Person(String name, int age) {}

people.sort(Comparator.comparing(Person::age));             // 나이 오름차순
people.sort(Comparator.comparing(Person::age).reversed());  // 나이 내림차순
people.sort(Comparator.comparing(Person::age)
                      .thenComparing(Person::name));        // 나이 같으면 이름순
```

`int` 필드라면 `Comparator.comparingInt(Person::age)`를 쓰면 박싱을 피할 수 있다.

## 원본을 바꾸지 않고 정렬된 결과만 받기

```java
List<Integer> sorted = list.stream().sorted().toList();
```

`Arrays.sort`와 `list.sort`는 **원본을 직접 바꾸는(in-place)** 방식이라는 점을 기억하자.

## 내부 알고리즘 차이 (면접 포인트)

| 대상 | 메서드 | 알고리즘 | 안정 정렬 | 최악 시간 |
|---|---|---|---|---|
| 기본형 배열 (`int[]` 등) | `Arrays.sort` | Dual-Pivot Quicksort | ❌ | O(n²) |
| 객체 배열 / List | `Arrays.sort`, `list.sort` | TimSort | ✅ | O(n log n) |

- **기본형에 퀵소트를 쓰는 이유**: 값이 같은 `int` 두 개는 서로 구별할 수 없으니 안정성이 의미 없다. 그래서 상수 계수가 작고 캐시 친화적인 퀵소트를 쓴다.
- **객체에 TimSort를 쓰는 이유**: 객체는 같은 키라도 다른 정보를 가질 수 있어서 기존 순서를 지키는 안정 정렬이 필요하다. 예를 들어 이름순으로 정렬한 뒤 나이순으로 다시 정렬하면 같은 나이 안에서는 이름순이 유지된다.
- **코딩 테스트 팁**: 퀵소트는 최악 O(n²)이라 이를 노린 입력(anti-quicksort)이 있을 수 있다. 문제가 되면 `Integer[]`로 바꿔 TimSort를 타게 하는 방법이 알려져 있다. (Dual-Pivot 구현은 최악 케이스를 만나기 어렵게 설계돼 있어서 실제로 문제가 되는 일은 드물다.)

## 한 줄 정리
> 배열은 `Arrays.sort`, 리스트는 `list.sort`. 기본형 배열은 Comparator를 못 쓰고 불변 리스트는 정렬할 수 없다. 기본형은 Dual-Pivot Quicksort(불안정), 객체는 TimSort(안정)를 쓴다.
