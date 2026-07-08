## Mutex Lock의 예시 (Java/Spring Boot)
Java에서는 내부적으로 `synchronized` 키워드나 `ReentrantLock`을 사용해 Mutex를 구현합니다. Spring Boot의 `@Cacheable(sync = true)`도 내부적으로 이 방식을 씁니다
```java
import java.util.concurrent.locks.ReentrantLock;

public class CacheService {
    private final ReentrantLock lock = new ReentrantLock();

    public String getCachedData() {
        // 1. 캐시 확인
        String data = redis.get("key");
        if (data != null) return data;

        // 2. 캐시가 없으면 Mutex Lock 획득 시도
        lock.lock(); 
        try {
            // 3. 락을 얻은 후 다시 한번 캐시 확인 (Double-Checked Locking)
            data = redis.get("key");
            if (data != null) return data;

            // 4. 진짜 없으면 DB 조회 후 캐시 저장
            data = db.findData();
            redis.put("key", data);
            return data;
        } finally {
            lock.unlock(); // 5. 자물쇠 해제 (대기하던 다른 쓰레드가 진입 가능)
        }
    }
}

```
## Mutex 기반 캐시 스탬피드 방어 흐름 (동작 방식)

1. **동시 유입:** 캐시가 만료된 순간, 쓰레드 A, B, C가 동시에 데이터를 요청합니다.
2. **캐시 미스:** 세 쓰레드 모두 캐시에서 데이터를 찾지 못합니다.
3. **선점 (락 획득):** 찰나의 차이로 **쓰레드 A**가 Mutex 락을 쥐고 DB 조회 권한을 얻습니다.
4. **대기 (블로킹):** 락을 얻지 못한 **쓰레드 B와 C**는 DB로 가지 못하고, 쓰레드 A가 일을 끝낼 때까지 줄을 서서 대기합니다.
5. **조회 및 저장:** 쓰레드 A가 DB에서 데이터를 조회해 와서 **캐시에 값을 채워 넣습니다.**
6. **락 해제 및 캐시 히트:** 쓰레드 A가 락을 해제하면, 대기하던 쓰레드 B와 C가 차례대로 진입합니다. 이때 이들은 **DB로 가지 않고, 방금 쓰레드 A가 채워둔 캐시에서 값을 즉시 가져옵니다(Cache Hit).**

## Redisson(분산락)을 써야 하는 이유

분산락(Distributed Lock)은 자물쇠를 각 서버 내부 메모리가 아니라, 모든 서버가 공통으로 바라보는 **외부 저장소(Redis)**에 두는 방식입니다.

```
[서버 1] ───┐
[서버 2] ───┼─► [ Redis 공통 자물쇠 ] ──► (오직 1등만 획득) ──► [ DB 조회 ]
[서버 3] ───┘
```

### Redisson을 사용하는 구체적 이유:
- **글로벌 단일 락 보장:** 어떤 서버에서 요청이 들어오든 Redis에 `SETNX` 같은 명령어로 "내가 자물쇠 잡았음"을 기록하므로, 클러스터 전체에서 딱 1개의 쓰레드만 DB에 접근하도록 통제할 수 있습니다.
- **스핀 락(Spin Lock) 부하 최적화:** Lettuce 같은 일반 Redis 라이브러리는 락을 얻을 때까지 Redis에 "락 풀렸냐?"라는 질문을 무한 반복(경쟁)하여 Redis에 부하를 줍니다. 반면 **Redisson은 Pub/Sub(발행/구독) 기반**으로 작동하여, 락이 풀리면 Redis가 대기 중인 서버에 알림을 주므로 네트워크 트래픽 부담이 극도로 적습니다.
