---
date: 2026-09-24
lastmod: 2026-09-24
tags:
draft: false
---
# 트라이(Trie)는 무엇이고 언제 쓰는가

"이 글자로 시작하는 단어가 있나? 몇 개나 있나?" 같은 **접두사 질문**을 받으면 가장 먼저 떠올려야 하는 자료구조다. 검색창 자동완성이 대표적인 예라서 코딩테스트와 면접 양쪽에 자주 나온다.

## 한마디로

**트라이는 문자열을 글자 단위로 쪼개서 트리에 저장하고, 앞부분(접두사)이 같은 단어끼리 경로를 공유하는 자료구조다.** 접두사 트리(prefix tree)라고도 부른다.

국어사전 찾기를 떠올리면 쉽다. "사과"를 찾을 때 단어 전체를 한꺼번에 비교하지 않고 **ㅅ → 사 → 사과** 순서로 범위를 좁혀 간다. 트라이도 똑같이 첫 글자부터 한 칸씩 내려가며 저장하고 찾는다.

## 구조: 단어를 넣으면 어떻게 생기나

`cat`, `car`, `dog` 순서로 넣어 보자.

```
① cat 추가      root → c → a → t

② car 추가      root → c → a → t         ← c → a 는 이미 있으니 재사용
                             ↘ r          ← a에서 새 갈래

③ dog 추가      root → c → a → t
                   │         ↘ r
                   ↘ d → o → g           ← 루트에서 새 갈래
```

알아둘 점은 세 가지다.

- **노드 하나 = 접두사 하나.** 루트는 빈 접두사 `""`이고, 루트에서 어떤 노드까지 지나온 글자를 이으면 그 노드의 접두사가 된다. 위 그림에서 `c → a` 노드는 `"ca"`다.
- **간선 하나 = 글자 하나.** 자식으로 내려가는 것은 다음 글자를 붙이는 것이다.
- **링크드 리스트가 아니라 트리다.** 글자를 이어 붙인다는 점은 링크드 리스트와 비슷하지만, 한 노드에서 **여러 갈래로 분기**할 수 있어야 해서(`a`에서 `t`와 `r`) 트리가 된다.

## 동작: 찾기는 글자 수만큼만 내려간다

- `"ca"`로 시작하는 단어가 있나? → `root → c → a`까지 두 칸 내려가면 **있다**. 그 아래 `t`, `r`에 cat과 car가 달려 있다.
- `"cu"`로 시작하는 단어가 있나? → `c`에 `u` 갈래가 없으니 **바로 없다**.

저장된 단어가 3개든 10만 개든 **찾는 문자열의 길이 L만큼만** 내려가면 된다. 이것이 트라이의 핵심 장점이다.

## 노드에 무엇을 저장할까: `end` vs `count`

노드에 붙이는 값은 **어떤 질문에 답할지**에 따라 고른다.

| 필드 | 의미 | 답할 수 있는 질문 |
|---|---|---|
| `boolean end` | 여기서 끝나는 단어가 있는가 | 단어가 **정확히** 있는가? `search("ca")`는 false, `search("cat")`은 true |
| `int count` | 이 노드를 **지나간** 단어 수 | 이 접두사로 시작하는 단어가 **몇 개**인가? |

`count`는 `insert`할 때 지나가는 모든 노드에 +1 해 둔다. 그러면 개수 질문은 경로 끝 노드의 값을 읽기만 하면 된다.

```
root → c(2) → a(2) → t(1)
   │             ↘ r(1)
   ↘ d(1) → o(1) → g(1)

countPrefix("ca") = 2,  countPrefix("d") = 1
```

## 자바 구현

`end`와 `count`를 둘 다 가진 버전이다.

```java
class Trie {

    static class Node {
        Node[] children = new Node[26];   // 'a'~'z' 한 칸씩, 처음엔 전부 null
        boolean end;                      // 여기서 끝나는 단어가 있는가
        int count;                        // 이 노드를 지나간 단어 수
    }

    private final Node root = new Node();

    void insert(String word) {
        Node cur = root;
        for (char c : word.toCharArray()) {
            int idx = c - 'a';                                  // 'a'→0 ... 'z'→25
            if (cur.children[idx] == null) cur.children[idx] = new Node();   // 없으면 그때 생성
            cur = cur.children[idx];
            cur.count++;                                        // 지나가는 노드마다 +1
        }
        cur.end = true;                                         // 단어의 마지막 글자 표시
    }

    boolean search(String word) {           // 정확히 그 단어가 있는가
        Node n = walk(word);
        return n != null && n.end;
    }

    boolean startsWith(String prefix) {     // 그 접두사로 시작하는 단어가 있는가
        return walk(prefix) != null;
    }

    int countPrefix(String prefix) {        // 그 접두사로 시작하는 단어 수
        Node n = walk(prefix);
        return n == null ? 0 : n.count;
    }

    private Node walk(String s) {           // 경로를 따라 내려가 마지막 노드 반환, 끊기면 null
        Node cur = root;
        for (char c : s.toCharArray()) {
            cur = cur.children[c - 'a'];
            if (cur == null) return null;
        }
        return cur;
    }
}
```

```java
Trie t = new Trie();
t.insert("cat"); t.insert("car"); t.insert("dog");

t.search("cat");       // true
t.search("ca");        // false  ← 접두사일 뿐 단어는 아님
t.startsWith("ca");    // true
t.startsWith("cu");    // false
t.countPrefix("ca");   // 2
```

### 자식 저장 방식: 배열 vs 맵

| | `Node[26]` 배열 | `Map<Character, Node>` |
|---|---|---|
| 자식 접근 | `c - 'a'` 인덱스로 바로, O(1) | 해시 계산 + char → Character 박싱 |
| 메모리 | 자식이 1개여도 26칸을 잡음 | 실제 있는 자식만 저장 |
| 문자 범위 | 고정 범위만 (예: 소문자) | 한글, 대소문자, 특수문자 무엇이든 |
| 언제 | 코딩테스트처럼 "소문자만" 조건이 있을 때 | 문자 종류가 많거나 자식이 드물 때 |

맵 버전은 `computeIfAbsent`로 "없으면 만들고 이동"을 한 줄로 쓸 수 있다.

```java
static class Node {
    Map<Character, Node> children = new HashMap<>();
    int count;
}

// insert 안에서
cur = cur.children.computeIfAbsent(c, k -> new Node());
cur.count++;

// 찾을 때
cur = cur.children.get(c);   // 없으면 null
```

### 클래스 안에 자기 자신 타입(`Node[]`)을 쓸 수 있는 이유

`Node` 정의 안에 `Node[]`가 나오는 게 처음엔 이상해 보인다. 이렇게 할 수 있는 이유는 **자바 객체 필드가 객체 자체가 아니라 참조(주소)를 담기 때문**이다. 참조는 가리키는 타입과 상관없이 크기가 고정이라, 정의가 끝나기 전에도 객체 크기를 계산할 수 있다. 링크드 리스트의 `Node next`와 같은 원리(자기 참조 클래스)다.

```java
Node next;                        // OK: 참조만 선언, 기본값 null
Node[] children = new Node[26];   // OK: null 26칸짜리 "배열"만 생성. Node는 0개
Node child = new Node();          // 컴파일은 되지만, new Node()가 또 new Node()를 불러 StackOverflowError
```

C 언어에서는 구조체가 자기 자신을 값으로 담으면 크기가 무한대가 되어 컴파일 에러가 나고, 반드시 포인터(`struct Node*`)로 써야 한다. 자바는 모든 객체 필드가 자동으로 참조라서 신경 쓸 필요가 없다.

## 복잡도와 다른 방법 비교

| 방법 | 정확히 일치 검색 | 접두사 검색·개수 | 메모리 |
|---|---|---|---|
| `List` + `startsWith` 순회 | O(N × L) | O(N × L) | 작음 |
| `HashSet` / `HashMap` | 평균 O(L) | **불가** (전부 훑어야 함) | 작음 |
| **트라이** | O(L) | **O(L)** | 큼 (노드 수 × 자식 칸) |

- `insert` / `search` / `startsWith` / `countPrefix` 모두 O(L)이다 (L = 문자열 길이).
- 대가는 **메모리**다. 배열 방식이면 노드마다 26칸을 들고 있다.

## 어디에 쓰나

- **검색어 자동완성**: 입력한 접두사 노드 아래의 단어들을 추천한다.
- 연락처·상품명 **접두사 검색**, 접두사로 시작하는 개수 세기 (→ [[Contacts]])
- 사전 검색, 금칙어 필터
- IP 라우팅의 최장 접두사 매칭(longest prefix match)

## 면접에서 한 문장으로

> "문자열을 글자 단위로 트리에 저장해 공통 접두사를 공유하는 구조이고, 검색 비용이 단어 수가 아니라 문자열 길이에 비례해서 접두사 검색이나 자동완성에 강합니다. 대신 노드마다 자식 포인터를 들고 있어서 메모리를 많이 씁니다."

"왜 배열을 골랐나요?"라는 꼬리 질문이 오면 이렇게 답한다: "입력이 소문자 26자로 고정이라 인덱스로 O(1) 접근하는 배열을 썼습니다. 문자 종류가 많아지면 대부분의 칸이 비니까 맵으로 바꾸겠습니다."

## 한 줄 정리
> 트라이 = 글자 단위로 쪼개 공통 접두사를 공유하는 트리. 노드 하나가 접두사 하나이고, 검색은 O(L)이다. 정확한 단어 검사에는 `end`, 접두사 개수에는 `count`를 쓰고, 자식은 문자 범위가 고정이면 배열, 넓으면 맵으로 저장한다. 대가는 메모리다.
