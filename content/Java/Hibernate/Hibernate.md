핵심 철학
개발자는 객체를 다루고 SQL은 Hibernate가 책임진다.

Hibernate는 Java 진영의 대표적인 **ORM(Object-Relational Mapping) 프레임워크**
관계형 데이터베이스(RDB)와 Java 객체(Object) 사이의 패러다임 불일치를 해결해 주는 도구
개발자가 SQL을 직접 작성하지 않아도 데이터베이스를 조작할 수 있게 해준다.

핵심 구조
![[Hibernate-20260321-163255.png]]

영속성 컨텍스트(Persistence Context)
`EntityManager`가 관리하는 **"엔티티의 임시 저장소"**
![[Hibernate-20260321-163356.png]]

Dirty Checking (변경 감지)
Hibernate는 영속 상태의 엔티티를 조회할 때, 그 **스냅샷(최초 상태의 복사본)** 을 함께 저장해 둔다.
트랜잭션이 커밋되는 시점에 현재 엔티티 상태와 스냅샷을 비교해서, 변경이 감지되면 **UPDATE SQL을 자동으로 생성**한다. 개발자가 `em.update()` 같은 메서드를 호출할 필요가 없다.

영속성 컨텍스트 내부 구조
- JVM 힙 메모리에 실제로 존재하는 데이터 구조
- **`Map<EntityKey, Object>` 형태의 해시맵**으로 구현

![[Hibernate-20260321-164132.png]]

영속 상태
**엔티티가 영속성 컨텍스트의 Map에 등록된 상태**입니다. 이 상태가 되어야 비로소 `Dirty Checking`, `1차 캐시`, `쓰기 지연` 같은 Hibernate의 모든 기능이 작동합니다.

Dirty Checking
트랜잭션 종료 시점(commit)에 영속성 컨텍스트가 관리하는 엔티티의 초기 스냅샷과 현재 상태를 비교하여, 변경된 데이터가 있다면 `UPDATE` SQL을 자동으로 생성해 DB에 반영하는 기능입니다. 별도의 `update()` 메서드 호출 없이 객체 수정만으로 데이터베이스에 반영되는 핵심 기능입니다.
