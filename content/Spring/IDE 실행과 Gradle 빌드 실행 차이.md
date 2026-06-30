---
date: 2025-12-31
lastmod: 2025-12-31
tags:
draft: false
---
# IDE에서 실행하면 Gradle은 정말 사용되지 않을까?

Spring Boot 프로젝트를 개발하다 보면 이런 말을 자주 듣는다.

> "IDE에서 실행하면 Gradle은 사용되지 않는다."

이 말은 **절반은 맞고 절반은 틀린 표현**이다.

정확히는 **프로젝트를 가져오는(Import) 과정에서는 Gradle을 사용하지만, 실행(Run) 단계에서는 대부분 IDE가 직접 컴파일하고 실행한다.**

이번 글에서는 IDE 실행과 Gradle 실행의 차이를 단계별로 알아보자.

---

# IDE 실행 시 Gradle은 언제 사용될까?

## 프로젝트를 처음 Import할 때

IntelliJ, Eclipse, VS Code와 같은 IDE는 Gradle 프로젝트를 열면 먼저 `build.gradle` 또는 `build.gradle.kts`를 확인한다.

하지만 단순히 파일 내용을 읽는 것이 아니다.

IDE는 **Gradle 자체를 실행**하여 프로젝트 정보를 가져온다.

대표적으로 다음과 같은 정보를 Gradle을 통해 얻는다.

- 프로젝트 구조
- Source Set
- Resource 경로
- JDK 버전
- 의존성(JAR)
- 플러그인 정보

즉,

> **Gradle은 프로젝트를 이해하기 위한 메타데이터를 제공하는 역할을 한다.**

---

# IDE는 build.gradle을 어떻게 분석할까?

예를 들어 다음과 같은 의존성이 있다고 가정하자.

```gradle
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'

    compileOnly 'org.projectlombok:lombok'

    runtimeOnly 'com.h2database:h2'

    testImplementation 'org.springframework.boot:spring-boot-starter-test'
}
```

IDE는 이 파일을 직접 해석하는 것이 아니라,

Gradle에게 다음과 같은 요청을 한다.

> "이 프로젝트의 의존성을 계산해줘."

실제로는 Gradle Tooling API를 사용하며, 내부적으로는 다음과 비슷한 작업이 수행된다.

```bash
./gradlew dependencies
```

그러면 Gradle은 의존성 그래프를 계산한다.

```
implementation
+--- spring-boot-starter-web
|    +--- spring-web
|    +--- spring-boot-starter-json
|
+--- spring-boot-starter-data-jpa
     +--- hibernate-core
```

IDE는 이 결과를 받아

- 필요한 JAR 다운로드
- Classpath 구성
- 자동완성
- Import
- 컴파일 설정

등에 활용한다.

---

# IDE 실행(Run) 시에는 어떻게 동작할까?

프로젝트 Import가 끝난 이후에는 상황이 달라진다.

Run 버튼을 누르면 일반적으로 다음 순서로 동작한다.

```
IDE
    ↓
Incremental Compiler
    ↓
.class 생성
    ↓
main() 실행
```

여기서는 Gradle이 개입하지 않는다.

즉,

- `compileJava`
- `bootRun`
- `processResources`

같은 Gradle Task는 실행되지 않는다.

IDE 내부 컴파일러(IntelliJ Compiler)가 변경된 파일만 빠르게 컴파일한 뒤 JVM에서 `main()`을 직접 실행한다.

---

# IDE 실행과 Gradle 실행의 차이

IDE 실행은 다음과 같다.

```
IDE
    ↓
Incremental Compile
    ↓
main()
```

반면 Gradle의 `bootRun`은

```
Gradle
    ↓
compileJava
    ↓
processResources
    ↓
bootRun
    ↓
main()
```

처럼 모든 과정을 Gradle이 관리한다.

---

# Gradle Build는 완전히 다른 과정이다

다음 명령을 실행하면

```bash
./gradlew build
```

Gradle은 IDE를 전혀 사용하지 않는다.

다음 Task들을 직접 수행한다.

```
clean
↓

compileJava
↓

processResources
↓

test
↓

bootJar
↓

build
```

즉,

> IDE가 생성한 `.class` 파일을 사용하는 것이 아니라,
> **Gradle이 처음부터 다시 컴파일한다.**

---

# 실행 방식별 차이

| 실행 방식 | 컴파일 주체 | 실행 대상 | Gradle 개입 |
|------------|------------|------------|-------------|
| IDE Run | IDE Compiler | IDE가 만든 `.class` | 거의 없음 |
| `bootRun` | Gradle | Gradle Classpath | 있음 |
| `java -jar` | 이미 빌드된 JAR | JAR 내부 | 실행 시 없음 |

---

# 실제 실행 흐름 비교

## IDE 실행

```
IntelliJ

↓

Incremental Compile

↓

target/classes

↓

main()
```

---

## Gradle bootRun

```
./gradlew bootRun

↓

compileJava

↓

processResources

↓

main()
```

---

## JAR 실행

```
./gradlew build

↓

bootJar

↓

build/libs/app.jar

↓

java -jar app.jar
```

---

# 왜 실무에서 중요할까?

Docker나 Kubernetes 환경에서는 대부분 다음과 같이 배포된다.

```bash
./gradlew build

java -jar app.jar
```

즉,

운영 환경은 **IDE 실행이 아니라 Gradle Build 결과물**을 사용한다.

그래서 이런 문제가 발생할 수 있다.

- IDE에서는 정상 실행됨
- Docker에서는 오류 발생

대표적인 원인은 다음과 같다.

- Classpath 차이
- Resource 포함 여부
- Annotation Processor 차이
- Lombok 처리 방식
- Spring Boot Repackage 여부

즉,

> **IDE 실행 결과를 운영 환경의 기준으로 생각하면 안 된다.**

운영 환경과 가장 유사한 테스트는

```bash
./gradlew build

java -jar build/libs/app.jar
```

으로 확인하는 것이다.

---

# IDE가 Gradle을 사용하는 이유

IDE는 Gradle을

> **빌드 도구**

로 사용하는 것이 아니라,

> **프로젝트 정보를 계산하는 도구**

로 사용한다.

정리하면

```
IDE 실행 전

↓

Gradle 실행

↓

의존성 계산

↓

JAR 다운로드

↓

Classpath 구성

↓

IDE 실행
```

실제 Run 버튼을 누른 이후에는 IDE가 직접 컴파일하고 JVM을 실행한다.

---

# 정리

IDE와 Gradle은 역할이 명확하게 다르다.

### IDE의 역할

- Gradle을 이용해 프로젝트 정보를 가져온다.
- 의존성을 계산한다.
- 자동완성과 컴파일 환경을 구성한다.
- Incremental Compile을 수행한다.
- `main()`을 직접 실행한다.

### Gradle의 역할

- 프로젝트 전체를 컴파일한다.
- Resource를 처리한다.
- 테스트를 수행한다.
- 실행 가능한 JAR를 생성한다.
- `bootRun`을 통해 Gradle 환경에서 실행한다.

---

# 한 줄 결론

> **IDE는 Gradle을 프로젝트 정보를 가져오기 위해 사용하고, 실제 실행은 IDE가 담당한다.**
>
> **반면 Gradle Build와 bootRun은 Gradle이 직접 컴파일부터 실행까지 모두 관리한다.**