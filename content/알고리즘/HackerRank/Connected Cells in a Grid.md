---
date: 2026-09-24
lastmod: 2026-09-24
tags:
draft: false
---
# Connected Cells in a Grid: DFS로 8방향 연결 영역의 최대 크기 구하기

격자에서 "서로 붙어 있는 덩어리" 중 가장 큰 것의 크기를 구하는 전형적인 Flood Fill 문제다. 대각선까지 연결로 치는 **8방향** 탐색이라는 점, 그리고 행과 열을 헷갈려서 생긴 버그 두 개가 정사각형 샘플에서는 드러나지 않았다는 점을 같이 정리해 둔다.

- 문제: [HackerRank - DFS: Connected Cell in a Grid](https://www.hackerrank.com/challenges/ctci-connected-cell-in-a-grid/problem)

## 문제 요약

- `n × m` 격자의 각 칸은 0 또는 1이다.
- 1인 칸끼리 **상하좌우 + 대각선(8방향)** 으로 붙어 있으면 같은 영역(region)이다.
- 가장 큰 영역에 속한 칸 수를 반환한다.

```
Input (4 x 4):
1 1 0 0
0 1 1 0
0 0 1 0
1 0 0 0

Output: 5
```

(0,0) → (0,1) → (1,1) → (1,2) → (2,2)가 이어져서 크기 5. (3,0)은 떨어져 있어서 크기 1.

## 접근 (핵심 아이디어)

모든 칸을 순회하다가 1을 만나면, 거기서 DFS로 연결된 칸을 전부 따라가며 개수를 센다. 센 칸은 **0으로 바꿔서 방문 처리**하므로, 이미 센 영역은 이후 순회에서 다시 시작점이 되지 않는다.

DFS 함수는 "이 칸에서 시작해 도달할 수 있는 1의 개수"를 반환한다. 그래서 `1(자기 자신) + 8방향 dfs 결과의 합`이 된다.

```
dfs(r, c) =
  범위 밖 or 값이 0  →  0
  그 외              →  1 + Σ dfs(r + dr, c + dc)   (8방향)
```

## 제출한 풀이

```java
class Result {

    // 8방향 이동량. 같은 인덱스끼리 짝지어 (DR[i], DC[i])가 한 방향이다.
    //  i:  0     1     2     3     4      5      6      7
    //     ↑     ↗     →     ↘     ↖      ←      ↙      ↓
    //   (-1,0)(-1,1)(0,1) (1,1) (-1,-1)(0,-1) (1,-1) (1,0)
    private static final int[] DR = {-1, -1, 0, 1, -1, 0, 1, 1};
    private static final int[] DC = {0, 1, 1, 1, -1, -1, -1, 0};

    // (row, col)에서 시작해 연결된 1의 개수를 반환한다.
    private static int dfs(List<List<Integer>> grid, int row, int col) {

        // 1) 종료 조건: 격자 밖이면 0
        //    - 열 범위는 grid.size()(행 개수)가 아니라 grid.get(row).size()(열 개수)로 검사한다.
        //    - row 검사가 앞에 있고 || 는 단락 평가라서, grid.get(row) 호출 시점엔 row가 항상 유효하다.
        if (row < 0 || row >= grid.size() || col < 0 || col >= grid.get(row).size()) {
            return 0;
        }

        // 2) 종료 조건: 빈 칸(0)이거나 이미 방문해서 0으로 바꾼 칸이면 0
        if (grid.get(row).get(col) == 0) return 0;

        // 3) 방문 처리: 1 → 0
        //    재귀 호출보다 먼저 해야 한다. 안 그러면 이웃이 다시 나를 호출해서 무한 재귀(StackOverflow).
        grid.get(row).set(col, 0);

        // 4) 자기 자신(1) + 8방향으로 이어진 칸 수를 누적
        int size = 1;
        for (int d = 0; d < 8; d++) {
            int nextRow = row + DR[d];
            int nextCol = col + DC[d];   // row가 아니라 col 기준!
            size += dfs(grid, nextRow, nextCol);   // 범위 검사는 dfs 첫 줄에서 하므로 여기선 생략
        }
        return size;
    }

    public static int maxRegion(List<List<Integer>> grid) {
        int answer = 0;
        for (int i = 0; i < grid.size(); i++)
            for (int j = 0; j < grid.get(i).size(); j++) {
                // 아직 방문하지 않은 1 = 새로운 영역의 시작점
                if (grid.get(i).get(j) == 1) {
                    answer = Math.max(dfs(grid, i, j), answer);
                }
            }
        return answer;
    }
}
```

> HackerRank 이 문제는 **non-ASCII 문자가 있으면 제출 자체를 거부**한다. 위 한글 주석은 노트용이고, 실제 제출할 때는 주석을 지우거나 영어로 써야 한다.

## 핵심 포인트

- **종료 조건을 재귀 함수 첫 줄에 몰아둔다.** 호출하는 쪽에서 `nextRow`/`nextCol` 범위를 일일이 검사하지 않아도 되니 코드가 단순해지고, 검사 누락도 줄어든다.
- **방문 처리를 입력 격자에 직접 한다.** 1을 0으로 바꾸면 `visited` 배열이 따로 필요 없다. 원본을 보존해야 하면 `boolean[][] visited`를 쓴다.
- **복잡도**: 각 칸은 한 번만 1 → 0이 되고, 한 칸당 이웃 8개만 보므로 시간 O(n·m). 재귀 깊이는 최악의 경우(전부 1) O(n·m).
- **8방향 배열 검증법**: (DR[i], DC[i])를 짝지어 봤을 때 8쌍이 모두 다르고 (0,0)이 없으면 맞다. 탐색 순서는 결과에 영향이 없다.

손 추적 — 실패했던 5×5 테스트(기대값 10):

```
r\c  0 1 2 3 4
0    A . A A .
1    A A . . A
2    . A A A .
3    . . . . A
4    B B B . .
```

(1,1)→(0,2), (0,3)→(1,4), (2,3)→(3,4)는 전부 **대각선** 연결이다. 이 대각선들을 제대로 따라가야 A 영역이 10이 된다. B(3칸)는 (3,1)~(3,3)이 0이라 A와 끊겨 있다.

## 주의할 점 / 흔한 실수

제출하면서 실제로 겪은 것들:

| 증상 | 원인 | 수정 |
|---|---|---|
| 컴파일 에러 | `maxRegion`은 `static`인데 `dfs`가 인스턴스 메서드 | `private static int dfs(...)` |
| Wrong Answer (5×5에서 10 대신 7) | `int nextCol = row + DC[d];` — 열을 행 기준으로 계산 | `col + DC[d]` |
| `IndexOutOfBoundsException: Index 4 out of bounds for length 4` (5×4 입력) | 열 범위를 `col >= grid.size()`(행 개수 5)로 검사해서 col=4가 통과 | `col >= grid.get(row).size()` |
| 제출 거부 | 한글 주석(non-ASCII) | 주석 제거 또는 영어로 |

- **행/열 혼동 버그는 정사각형 샘플에서 안 드러난다.** n == m이면 `grid.size()`와 `grid.get(row).size()`가 같으니까. 제출 전에 **2×5, 5×3 같은 직사각형 입력**을 머릿속으로 한 번 돌려보자.
- **4방향이 아니라 8방향이다.** 문제를 대충 읽고 상하좌우만 보면 대각선 연결을 놓친다.
- **격자가 크면 재귀가 위험하다.** 이 문제는 n, m < 10이라 괜찮지만, 1000×1000이면 재귀 깊이가 최대 10⁶까지 가서 StackOverflow가 난다. 이땐 `ArrayDeque`로 BFS를 하거나 명시적 스택으로 반복 DFS를 쓴다.
- 배열 대신 이중 루프로 8방향을 도는 방법도 있다. 오타 여지가 없어서 라이브 코딩에서 더 안전하다.

```java
for (int dr = -1; dr <= 1; dr++)
    for (int dc = -1; dc <= 1; dc++) {
        if (dr == 0 && dc == 0) continue;
        size += dfs(grid, row + dr, col + dc);
    }
```

## 한 줄 정리
> 1을 만나면 DFS로 따라가며 0으로 지우고 `1 + 8방향 합`을 센다. 종료 조건(범위 → 0 체크 → 방문 처리)을 재귀 첫머리에 두고, 열 범위는 `grid.get(row).size()`, 다음 열은 `col + DC[d]` — 행/열 혼동은 직사각형 입력으로 검증한다.
