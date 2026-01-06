

```yaml
version: '3.8'  
services:  
  postgres:  
    image: postgres:15  
    container_name: chat-postgres  
    ports:  
      - "5433:5432"  
    environment:  
      POSTGRES_DB: chatdb  
      POSTGRES_USER: postgres  
      POSTGRES_PASSWORD: password  
    volumes:  
      - postgres-data:/var/lib/postgresql/data  
  
  redis:  
    image: redis:7-alpine  
    container_name: chat-redis  
    ports:  
      - "6380:6379"  
    volumes:  
      - redis-data:/data  
  
volumes:  
  postgres-data:  
  redis-data:
```

## volumes 섹션
- Docker가 관리하는 **Named Volume**
- 실제 위치:
```swift
/var/lib/docker/volumes/...
```
- `postgres-data`라는 볼륨을 컨테이너 내부의 `/var/lib/postgresql/data`에 연결하겠다

## volumes 섹션에서 정의한 볼륨은 실제 로컬에 있나?
Yes. 실제 로컬에 존재한다. 하지만 Linux가 아닌 OS에서는 Docker Desktop을 통해 Linux VM 내부에 존재한다.
```swift
Docker VM
└── /var/lib/docker/volumes/chat-server_postgres-data/_data
        ▲
        │ (마운트)
        │
Container (chat-postgres)
└── /var/lib/postgresql/data
```
- 