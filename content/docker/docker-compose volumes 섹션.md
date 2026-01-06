

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


volumes

```swift
Docker VM
└── /var/lib/docker/volumes/chat-server_postgres-data/_data
        ▲
        │ (마운트)
        │
Container (chat-postgres)
└── /var/lib/postgresql/data
```