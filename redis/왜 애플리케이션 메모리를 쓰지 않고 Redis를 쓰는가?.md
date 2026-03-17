
## Java 메모리 저장소 vs Redis

### 1. TTL 관리
Java 메모리 캐시 구현
- TTL 구현하려면 만료 스레드 필요
- 주기적으로 검사
- 메모리 정리 로직 필요
- GC 부담 증가

Redis 내부 동작
- passive expiration (접근 시 삭제)
- active expiration (백그라운드 정리)
즉 **TTL 관리가 Redis 내부에 이미 최적화되어 있음**
![[image-5.png]]

### 2. 다양한 자료구조
Redis는 단순 Key-Value 저장소가 아니라 다양한 자료구조를 제공합니다.  
예를 들어 Sorted Set을 이용하면 랭킹 시스템을 쉽게 구현할 수 있고 List는 메시지 큐처럼 사용할 수 있습니다.  
이런 기능을 Java 메모리 캐시로 구현하려면 자료구조 관리와 동시성 제어를 직접 구현해야 하기 때문에 Redis를 사용하는 것이 훨씬 효율적입니다.

### 3. 다양한 캐시 전략
Redis는 다양한 캐시 전략(Cache Aside, Write Through 등)을 쉽게 구현할 수 있어 **DB 부하를 줄이는 캐시 계층으로 많이 사용됩니다.**

## TTL 관리 어떻게 동작하지?

