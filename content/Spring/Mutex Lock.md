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

---
## Double-check (Double-Checked Locking) 방식
Double-Checked Locking(더블 체크드 락킹)은 소프트웨어 디자인 패턴 중 하나로, "락을 획득하기 직전"과 "락을 획득한 직후"에 공유 자원(여기서는 캐시)의 상태를 총 두 번(Double) 확인(Check)하는 동시성 제어 패턴

### 왜 2번 검사하는가?
락을 얻기 위해 줄을 서서 대기하던 쓰레드들이, 앞선 쓰레드가 캐시를 이미 채워놓았음에도 불구하고 자신이 락을 잡았다는 이유로 DB를 또 조회하는 불상사를 막기 위함

## Redisson 분산락 + Double-check 흐름

```
[시작] 쓰레드 A, B 동시 진입
  │
  ├── 1st Check: 캐시 확인 ──► 둘 다 없음! (Cache Miss)
  │
  ├── 락 획득 경쟁
  │     ├── 쓰레드 A: 분산락 획득 성공 (로직 진행)
  │     └── 쓰레드 B: 분산락 획득 실패 (락 해제될 때까지 대기)
  │
  ├── [쓰레드 A 작업] DB 조회 ──► 캐시 채워넣음 ──► 분산락 해제(Unlock)
  │
  └── [쓰레드 B 대기 종료] 락 획득 성공!
        │
        └── 2nd Check: 캐시 재확인 ──► "어? 캐시가 이미 있네!" (Cache Hit)
              └── DB 조회 없이 캐시값 즉시 반환 🚀
```

```java
@Component
@RequiredArgsConstructor
public class ProductCacheService {

    private final RedisTemplate<String, Object> redisTemplate;
    private final RedissonClient redissonClient;
    private final ProductRepository productRepository;

    public ProductDto getProductWithDistributedLock(Long productId) {
        String cacheKey = "product:" + productId;
        String lockKey = "lock:product:" + productId;

        // 1st Check: 락을 걸기 전에 먼저 캐시를 확인합니다 (대부분의 정상 상황은 여기서 빠르게 처리됨)
        ProductDto cachedData = (ProductDto) redisTemplate.opsForValue().get(cacheKey);
        if (cachedData != null) {
            return cachedData; // Cache Hit!
        }

        // 캐시가 없으므로 분산락 획득 시도
        RLock lock = redissonClient.getLock(lockKey);
        try {
            // 락 획득을 위해 최대 5초 대기, 락 점유 시간은 3초로 설정
            boolean available = lock.tryLock(5, 3, TimeUnit.SECONDS);
            
            if (!available) {
                // 락 획득 실패 시, 시스템 상황에 맞게 에러를 던지거나 원본 DB를 강제로 바라보게 처리
                throw new RuntimeException("락을 획득하지 못했습니다."); 
            }

            // 2nd Check (★ 핵심: Double-check): 락을 잡은 직후 캐시를 "다시 한 번" 확인합니다.
            // 줄 서서 기다리는 동안 앞서간 쓰레드가 캐시를 이미 채워두었을 수 있기 때문입니다.
            cachedData = (ProductDto) redisTemplate.opsForValue().get(cacheKey);
            if (cachedData != null) {
                return cachedData; // 대기하던 뒤쪽 쓰레드들은 여기서 무조건 걸러져서 DB로 안 내려감!
            }

            // 진짜로 아무도 캐시를 안 채웠다면, 락을 쥔 단 하나의 쓰레드만 DB를 조회합니다.
            Product product = productRepository.findById(productId)
                    .orElseThrow(() -> new IllegalArgumentException("상품이 존재하지 않습니다."));
            
            ProductDto dto = ProductDto.from(product);

            // 조회한 데이터를 캐시에 채워넣습니다 (TTL 10분 설정)
            redisTemplate.opsForValue().set(cacheKey, dto, 10, TimeUnit.MINUTES);
            
            return dto;

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException(e);
        } finally {
            // 작업이 끝나면 무조건 락을 해제하여 대기하던 다음 쓰레드를 들여보냅니다.
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}

```

