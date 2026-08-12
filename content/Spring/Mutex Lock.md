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

## Double-check을 쉽게 말하면

편의점에 물건을 사러 갔다고 하자.

- 매대를 봤는데(1st Check) 물건이 없다. 그래서 직원을 부르려고 줄을 선다(락 대기).
- 그런데 내가 줄 서 있는 동안, 바로 앞사람이 이미 직원한테 물건을 채워달라고 해서 매대에 물건이 다시 채워졌을 수 있다.
- 내 차례가 됐을 때(락 획득 직후) 굳이 창고까지 가지(DB 조회) 않고, 매대를 다시 한번 보면(2nd Check) 이미 채워져 있는 걸 발견하고 그냥 집으면 된다.

1st Check는 "애초에 락이 필요한 상황인지"를 걸러내는 용도이고, 2nd Check는 "내가 대기하는 동안 누가 이미 채워놨을 수도 있으니, 중복으로 DB에 가지 않기 위한" 용도다. 2nd Check를 생략하면 대기하던 요청이 전부 DB로 몰려가버려서 Cache Stampede를 막는 의미가 없어진다.

## 대규모 요청에서 락 대기가 실제로 도는 방식 (Pub/Sub, 폴링 아님)

위 다이어그램은 쓰레드 2개(A, B) 기준이지만, 실제로는 수천 개의 요청이 동시에 몰리는 상황(예: 출근 시간대 공지 캐시 만료)을 가정해야 한다. R1~R3000이 몰렸다고 하자.

```
09:00:00.000 — 공지 캐시 TTL 만료, R1~R3000 동시 도착
                     │
                     ▼
              전부 캐시 조회 → Cache Miss
                     │
                     ▼
        전부 Redisson lock() 호출 (대기 후 획득)
                     │
   ┌─────────────────┼──────────────────────┐
   ▼                                         ▼
  R1                                  R2 ~ R3000
락 획득 성공                        락 획득 실패 → 채널 구독하고 대기
   │                                    (폴링 아님! 알림 올 때까지 대기)
Double-check(캐시 재확인, 없음)              │
   │                                         │
DB 조회 → 캐시 저장                            │
   │                                         │
락 해제 → Redis가 채널에 "풀림" 메시지 발행 ─────┤
                                              ▼
                              대기자 전원이 알림을 받고 동시에 재도전
                              → 이번에도 Redis가 순차 처리하므로 딱 하나(R2)만 성공
                              → R2: Double-check → "이미 있네!"(Cache Hit)
                              → DB 안 가고 즉시 반환 → 곧바로 락 해제
                              → 다시 알림 발행 → R3 획득 → ... (R3000까지 반복)
```

**핵심**: 락을 못 얻은 요청은 "락 풀렸냐?"를 계속 물어보는 폴링이 아니라, Redis의 Pub/Sub 채널을 구독해두고 알림이 올 때까지 가만히 대기한다(그래야 Redis에 불필요한 부하가 안 걸린다). 락이 풀리면 대기자 전원이 알림을 받아 동시에 재도전하지만, Redis는 명령을 하나씩 순차 처리하므로 매번 딱 하나만 락을 잡는다.

R1 이후의 모든 사이클(R2, R3, ... R3000)은 "락 획득 → 캐시 읽기(Hit) → 즉시 해제"로 끝나는, DB 접근이 없는 인메모리 연산이라 매우 빠르다. DB에 실제로 접근하는 건 맨 처음 캐시를 채운 R1 단 한 번뿐이다 — 그래서 수천 건의 요청이 몰려도 DB 조회는 1건으로 끝난다.

---

## tryLock(0) 즉시 포기 방식 — 스케줄 중복 실행 방지

지금까지 본 `lock(leaseTime)`은 "대기 후 획득" 방식이다. 락을 못 잡은 쓰레드도 결국은 대기했다가 락을 잡아서 값을 읽어가야 한다(Cache Stampede처럼 모두가 응답을 받아야 하는 상황). 하지만 목적이 다르면 락을 못 잡았을 때 **그냥 포기하는 게 맞는** 경우도 있다.

### 상황: 멀티 인스턴스 스케줄러 중복 실행 방지

Kubernetes에 Pod A, B, C 세 개가 떠 있고, 각 Pod의 Spring Scheduler가 매일 같은 시각에 "알림 발송" 로직을 실행하도록 설정돼 있다고 하자. 아무 조치가 없으면 셋 다 동시에 알림을 보내버린다.

```
09:00:00.000 — Pod A, B, C 세 인스턴스가 동시에 스케줄러를 트리거
                     │
                     ▼
        셋 다 동시에 Redis에 tryLock(0, 10초) 요청
                     │
   ┌─────────────────┼─────────────────┐
   ▼                 ▼                 ▼
 Pod A             Pod B             Pod C
락 획득 실패      락 획득 성공!      락 획득 실패
(즉시 포기)       (10초간 유효)      (즉시 포기)
   │                 │                 │
   ▼                 ▼                 ▼
아무것도 안 함    알림 발송 로직     아무것도 안 함
                  실행 → 완료
                  → unlock()
```

```java
RLock lock = redissonClient.getLock("lock:schedule:notify");
boolean acquired = lock.tryLock(0, 10, TimeUnit.SECONDS); // waitTime=0: 대기 없이 즉시 실패
if (acquired) {
    try {
        // 알림 발송 로직 — 이 Pod만 실행
    } finally {
        lock.unlock();
    }
}
// 획득 실패한 Pod는 이 회차를 그냥 skip
```

### 왜 대기하지 않고 즉시 포기하는가

이 작업은 "누군가 한 명만 하면 되는" 작업이다. 락을 못 얻은 Pod가 기다렸다가 나중에 락을 잡아봐야, 이미 다른 Pod가 알림을 보낸 뒤라 또 보내면 중복 알림이 된다. 그래서 실패하면 대기하지 않고 그 회차를 그냥 포기하는 게 맞다.

### 대기 후 획득 vs 즉시 포기 비교

| 구분 | 대기 후 획득 `lock(leaseTime)` | 즉시 포기 `tryLock(0, TTL)` |
|------|------------------------------|------------------------------|
| 예시 | Cache Stampede 방지 | 스케줄 중복 실행 방지 |
| 락 실패 시 | 대기했다가 결국 캐시를 읽어감 (정상 응답) | 요청을 그냥 skip (중복 방지) |
| 목적 | 모두가 결과를 받아야 함 → DB 중복 조회만 차단 | 한 곳만 실행되면 됨 → 중복 실행 자체를 차단 |

