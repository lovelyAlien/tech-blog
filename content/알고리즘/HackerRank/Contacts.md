---
date: 2026-09-24
lastmod: 2026-09-24
tags:
draft: false
---
# Contacts: 트라이(Trie)에 count를 심어 접두사 개수를 O(L)로 세기

"이 접두사로 시작하는 단어가 몇 개인가?"를 빠르게 답해야 하는 문제다. 처음에는 "링크드 리스트처럼 글자를 이어 붙이면 되겠다"고 생각했는데, 방향은 맞았고 그 구조가 **트라이**였다. 여기에 **노드마다 count를 저장**하는 발상 하나가 더해져야 시간 안에 통과한다.

- 문제: [HackerRank - Tries: Contacts](https://www.hackerrank.com/challenges/contacts/problem)

## 문제 요약

- `add name`: 연락처 이름을 추가한다 (소문자, 중복 추가 없음).
- `find partial`: `partial`로 시작하는 연락처 수를 출력한다.
- 쿼리는 최대 10만 개다.

```
Input:
4
add hack
add hackerrank
find hac
find hak

Output:
2
0
```

## 접근 (핵심 아이디어)

**브루트포스**: 이름을 리스트에 넣고, `find`할 때마다 전부 돌며 `startsWith`로 센다. `find` 한 번이 O(N × L)이라 쿼리가 많으면 시간 초과가 난다.

**관점 전환: 트라이.** 트라이는 문자열을 글자 단위로 쪼개 트리에 저장하는 자료구조다. 국어사전에서 "사과"를 찾을 때 ㅅ → 사 → 사과 순서로 좁혀 가는 것과 같다.

```
add cat, add car, add dog

root → c → a → t      ← "ca"까지는 cat과 car가 공유
   │         ↘ r
   ↘ d → o → g
```

- **노드 하나가 접두사 하나**다. 루트(빈 접두사 `""`)에서 그 노드까지 지나온 글자를 이으면 접두사가 된다.
- 링크드 리스트와 달리 한 노드가 **여러 갈래로 분기**한다. 그래서 리스트가 아니라 트리다.
- 검색은 저장된 단어 수와 무관하게 **찾는 문자열 길이 L만큼만** 내려가면 된다.

**한 발 더: count.** 접두사 노드까지 가도 그 아래 단어를 DFS로 세면 여전히 느리다. 그래서 `add`할 때 **지나가는 모든 노드의 count를 +1** 해 둔다. 그러면 `find`는 경로를 따라 내려가서 마지막 노드의 count를 읽기만 하면 된다.

```
root → c(2) → a(2) → t(1)
   │             ↘ r(1)
   ↘ d(1) → o(1) → g(1)

find ca → a 노드의 count = 2
```

## 제출한 풀이

```java
class Result {

    // 트라이 노드 1개 = 접두사 1개
    static class Node {
        int count;                        // 이 노드를 지나간 단어 수 = 이 접두사로 시작하는 단어 수
        Node[] children = new Node[26];   // 다음 글자로 가는 갈림길. 'a'~'z' 한 칸씩 (처음엔 전부 null)
    }

    public static List<Integer> contacts(List<List<String>> queries) {
        List<Integer> answer = new ArrayList<>();
        Node root = new Node();                     // 빈 접두사 ""

        for (List<String> q : queries) {
            String op = q.get(0);
            String word = q.get(1);

            if (op.equals("add")) {
                Node cur = root;
                for (char c : word.toCharArray()) {
                    int idx = c - 'a';              // 'a'→0 ... 'z'→25
                    if (cur.children[idx] == null) {
                        cur.children[idx] = new Node();   // 처음 가는 길이면 그때 노드 생성
                    }
                    cur = cur.children[idx];
                    cur.count++;                    // 지나가는 모든 노드에 +1 (핵심)
                }
            } else { // find
                Node cur = root;
                for (char c : word.toCharArray()) {
                    int idx = c - 'a';
                    cur = cur.children[idx];
                    if (cur == null) {
                        break;                      // 경로가 끊김 = 그런 접두사 없음
                    }
                }
                answer.add(cur == null ? 0 : cur.count);
            }
        }
        return answer;
    }
}
```

> 한글 주석은 노트용이다. HackerRank에서 non-ASCII 주석 때문에 제출이 거부된 적이 있으니, 실제 제출할 때는 주석을 지우거나 영어로 쓴다.

## 핵심 포인트

- **복잡도**: `add`와 `find` 모두 O(L)이다. 저장된 단어 수 N과 무관하다. 대신 메모리는 최악의 경우 (전체 글자 수 × 26칸)으로, 트라이의 대가는 메모리다.
- **노드에 무엇을 저장할지는 질문에 따라 다르다.**

  | 필드 | 의미 | 쓰는 곳 |
  |---|---|---|
  | `boolean end` | 여기서 끝나는 단어가 있는가 | 단어가 정확히 있는지 검사 (`search("ca")`는 false) |
  | `int count` | 이 노드를 지나간 단어 수 | 접두사로 시작하는 단어 **개수** ← 이 문제 |

  이 문제는 개수만 물어서 `end`가 필요 없다.
- **자식 저장 방식: 배열 vs 맵**

  | | `Node[26]` | `Map<Character, Node>` |
  |---|---|---|
  | 접근 | `c - 'a'` 인덱스로 O(1) | 해시 조회 + char 박싱 |
  | 메모리 | 자식이 1개여도 26칸 | 실제 자식만 |
  | 문자 범위 | 고정 범위만 (소문자) | 한글, 대소문자 등 무엇이든 |

  소문자만 나오니 배열을 골랐다. 맵으로 쓰면 `cur = cur.children.computeIfAbsent(c, k -> new Node());` 한 줄로 "없으면 만들고 이동"이 된다.
- **클래스 안에 `Node[]`를 선언할 수 있는 이유**: 자바 객체 필드는 객체 자체가 아니라 **참조(주소)**를 담고, 참조는 크기가 고정이다. 그래서 자기 자신 타입을 필드로 가질 수 있다 (링크드 리스트의 `Node next`와 같은 원리). `new Node[26]`은 null 26칸짜리 배열을 만들 뿐 Node를 하나도 생성하지 않는다.

  ```java
  Node[] children = new Node[26];   // OK: null 배열
  Node child = new Node();          // 컴파일은 되지만 new Node()가 무한히 이어져 StackOverflowError
  ```

## 주의할 점 / 흔한 실수

- **count를 단어 끝 노드에만 올리면** 접두사 개수를 셀 수 없다. 지나가는 **모든** 노드에 올려야 한다.
- **`find`에서 null 체크를 빼면 NPE**가 난다. 경로가 끊기는 순간 `break`하고, 반복문 밖에서 `cur == null`이면 0을 넣는다.
- **루트 count**: 이 풀이는 루트의 count를 올리지 않으므로 빈 접두사로 `find`하면 0이 나온다. 이 문제 입력에는 빈 접두사가 없어서 상관없지만, 전체 단어 수를 원한다면 `add` 시작할 때 `root.count++`를 한다.
- **중복 add가 가능한 변형**이라면 count가 부풀어 오른다. 이때는 `HashSet`으로 먼저 걸러야 한다.
- 소문자 외 문자가 들어오면 `c - 'a'`가 범위를 벗어난다. 그럴 때는 맵으로 바꾼다.

## 한 줄 정리
> 트라이는 글자 단위로 공통 접두사를 공유하는 트리라서 검색이 O(L)이다. `add`할 때 지나가는 노드마다 count를 +1 해 두면 `find`는 접두사 경로 끝의 count를 읽기만 하면 된다. 소문자 고정이면 `Node[26]`, 문자 범위가 넓으면 `Map`을 쓴다.
