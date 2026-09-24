---
date: 2026-09-22
lastmod: 2026-09-22
tags:
draft: false
---
# Balanced Brackets: 스택으로 괄호 짝 맞추기, 그리고 Stack보다 ArrayDeque

괄호 문자열이 균형 잡혀 있는지 판정하는 전형적인 스택 문제. 처음 짠 코드에서 `EmptyStackException` 런타임 에러가 났고, 고치는 과정에서 `java.util.Stack` 대신 `ArrayDeque`를 쓰는 게 왜 권장되는지까지 같이 정리해 둔다.

- 문제: [HackerRank - Balanced Brackets](https://www.hackerrank.com/challenges/balanced-brackets/problem)

## 문제 요약

- 괄호(`{} [] ()`)로만 이루어진 문자열 `s`가 주어진다. 짝이 올바르게 맞으면 `"YES"`, 아니면 `"NO"`를 반환한다.
- "올바르다"는 건 두 가지 조건이다: ① 닫는 괄호가 나올 때 바로 앞에 대응하는 여는 괄호가 있어야 하고, ② 문자열이 끝났을 때 안 닫힌 여는 괄호가 남아 있으면 안 된다.

```
Input:  "{[()]}"   →  YES
Input:  "{[(])}"   →  NO   (순서가 꼬임)
Input:  "((("      →  NO   (안 닫힌 괄호가 남음)
Input:  "}{"        →  NO   (닫는 괄호가 먼저 나옴)
```

## 접근: 여는 괄호는 쌓아두고, 닫는 괄호는 맨 위와 비교

여는 괄호를 만나면 스택에 쌓아두고, 닫는 괄호를 만나면 스택 맨 위(가장 최근에 열린 괄호)와 짝이 맞는지 확인한다. 맞으면 pop, 안 맞으면 그 자리에서 바로 "NO". 문자열을 다 순회했을 때 스택이 비어 있어야 모든 괄호가 닫힌 것이다.

## 처음 작성한 코드와 런타임 에러

```java
public static String isBalanced(String s) {
    Stack<Character> stack = new Stack<>();

    for (int i = 0; i < s.length(); i++) {
        char cur = s.charAt(i);

        if (cur == '{' || cur == '[' || cur == '(') {
            stack.add(cur);
        } else {
            char top = stack.peek();   // 여기서 터진다

            if ((top == '{' && cur == '}') ||
                (top == '[' && cur == ']')
                || (top == '(') && cur == ')') {
                stack.pop();
            } else return "NO";
        }
    }
    return "YES";
}
```

`}{`처럼 닫는 괄호가 먼저 나오거나, 닫는 괄호 개수가 여는 괄호보다 많으면 스택이 빈 상태에서 `peek()`을 호출하게 된다. 빈 스택에 `peek()`/`pop()`을 호출하면 `EmptyStackException`이 던져져서 프로그램이 그대로 죽는다.

여기에 로직 버그도 하나 더 있었다: 마지막에 `stack.isEmpty()`를 확인하지 않고 무조건 `"YES"`를 반환하고 있어서, `"((("` 같이 여는 괄호만 있고 하나도 안 닫힌 입력도 `"YES"`로 잘못 판정된다.

## 1차 수정: 빈 스택 체크 추가

```java
public static String isBalanced(String s) {
    Stack<Character> stack = new Stack<>();

    for (int i = 0; i < s.length(); i++) {
        char cur = s.charAt(i);

        if (cur == '{' || cur == '[' || cur == '(') {
            stack.add(cur);
        } else {
            if (stack.isEmpty()) return "NO";   // peek 전에 빈 스택 방어

            char top = stack.peek();

            if ((top == '{' && cur == '}')
                || (top == '[' && cur == ']')
                || (top == '(' && cur == ')')) {
                stack.pop();
            } else {
                return "NO";
            }
        }
    }
    return stack.isEmpty() ? "YES" : "NO";   // 끝나고도 스택이 비어야 YES
}
```

닫는 괄호를 만났을 때 `peek()`을 호출하기 **전에** `isEmpty()`부터 확인하도록 순서를 바꿨고, 루프가 끝난 뒤 스택이 비었는지도 최종적으로 확인하도록 반환문을 고쳤다. 이 두 줄이 이 문제의 실질적인 정답 조건이다.

## 2차 개선: Deque/ArrayDeque + Map으로 정리

```java
public static String isBalanced(String s) {
    Map<Character, Character> pairs = Map.of(
        '}', '{',
        ')', '(',
        ']', '['
    );

    Deque<Character> stack = new ArrayDeque<>();
    for (char cur : s.toCharArray()) {
        if (cur == '{' || cur == '[' || cur == '(') {
            stack.push(cur);
        } else {
            if (stack.isEmpty() || stack.pop() != pairs.get(cur))
                return "NO";
        }
    }
    return stack.isEmpty() ? "YES" : "NO";
}
```

동작은 1차 수정 버전과 동일하지만 두 가지를 정리했다.

- **닫는 괄호 → 여는 괄호 매핑을 `Map`으로 뺐다.** if-else 체인 3개를 `pairs.get(cur)` 조회 한 줄로 줄였다. 괄호 종류가 늘어나도 코드 구조를 바꿀 필요가 없다.
- **`peek()` 후 `pop()`을 `pop()` 한 번으로 합쳤다.** 어차피 조건이 맞으면 pop할 거라서, 미리 꺼내서(`pop()`) 비교해도 결과는 같다. `stack.pop() != pairs.get(cur)`처럼 조회와 제거를 한 줄로 묶었다.

## Stack vs ArrayDeque, 왜 바꿨나

| | `java.util.Stack` | `Deque` (`ArrayDeque`) |
|---|---|---|
| 계보 | `Vector`를 상속한 레거시 클래스 (JDK 1.0) | `Deque` 인터페이스의 배열 기반 구현체 |
| 동기화 | 모든 메서드가 `synchronized` — 단일 스레드에서도 락 오버헤드 발생 | 동기화 없음, 필요하면 직접 처리 |
| 권장 여부 | Java 공식 문서에서도 스택 용도로는 `Deque` 사용을 권장 | 권장 |
| API | `push`/`pop`/`peek` 외에 `add`, `get(i)` 등 `Vector`의 메서드도 그대로 노출됨 (스택인데 임의 인덱스 접근이 가능해버림) | `Deque` 용도에 맞는 메서드만 노출 |

`stack.add(cur)`도 동작은 하지만 스택으로 쓰겠다는 의도가 드러나지 않는다. `add`는 `Vector`가 제공하는 일반 리스트 메서드일 뿐이라서, 나중에 코드를 읽는 사람이 "이게 스택 push인지" 한 번 더 생각해야 한다. `push(cur)`로 쓰면 스택 연산이라는 게 이름에서 바로 보인다.

## 한 줄 정리
> 닫는 괄호를 만났을 때 `peek()`/`pop()`을 호출하기 전에 반드시 `isEmpty()`를 먼저 확인하고, 순회가 끝난 뒤에도 스택이 비어 있는지 확인해야 진짜 "균형"이 맞는지 알 수 있다. 스택 용도로는 레거시 `Stack` 대신 `ArrayDeque`를 쓰는 게 관용구다.
