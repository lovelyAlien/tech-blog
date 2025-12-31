# 🧩 1. @Valid 는 “검증을 실행하라”는 트리거

Spring MVC에서 컨트롤러에 이런 코드가 있다고 하자:

```java
@PostMapping("/search")
public ResponseDto search(@Valid @RequestBody SearchResultRequest request) {
    ...
}
```

여기서 `@Valid` 는 이렇게 동작해:

### ✔ `@Valid` 의 역할

- Spring에게 **이 DTO에 대해 Bean Validation을 실행하라**고 알려줌
- DTO 필드에 붙은 `@NotNull`, `@Size`, `@Pattern`, `@Email` 등을 모두 검사해야 함을 의미
- 즉, “검증 필요”를 알리는 **메타 정보(지시문)**

따라서 `@Valid` 는 **스스로 검사하지 않고 “검사해야 한다”는 플래그만 제공**해.

---

# 🔧 2. Validator 는 실제로 검증하는 객체 (엔진)

`@Valid` 가 붙어 있다면 Spring 은 내부적으로 다음 과정을 실행해:

1. 스프링 MVC가 HandlerMethodArgumentResolver 단계에서 `@Valid` 를 감지
2. 내부에서 `javax.validation.Validator`(정확히는 Hibernate Validator 구현체)를 가져옴
3. DTO 객체를 Validator에게 전달하여 실제 검증 수행

```java
validator.validate(request);

```

이게 실제로 동작하는 코드 흐름.

### ✔ Validator의 역할

- DTO 필드에 선언된 모든 제약(@NotNull, @Size 등)을 읽음
- 조건 위반 시 ConstraintViolation 목록 생성
- 위반이 하나라도 있으면 MethodArgumentNotValidException 발생시킴

---

# 🔗 3. @Valid 와 Validator의 관계를 그림으로

```
Controller (@Valid 붙은 DTO)
        ↓  “검증해라”
Spring MVC Validation Layer
        ↓  DTO 전달
Validator (Hibernate Validator 엔진)
        ↓  주어진 Validation Annotation 실행
ConstraintViolation 결과 생성

```

즉:

> @Valid = “유효성 검사 해야 함!”
> 
> Validator = “오케이, 내가 실제로 검사할게.”

---

# 📝 4. 테스트 코드에서는 왜 Validator 를 직접 만드나?

실제 서버에서는 Spring 이 자동으로 Validator 를 가져다 검사하지만,

단위 테스트에서는 **Spring 컨텍스트를 띄우지 않기 때문에 @Valid가 동작하지 않아**.

그래서 직접 Validator를 생성하는 것:

```java
ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
Validator validator = factory.getValidator();
validator.validate(request);

```

➡️ 즉, 테스트에서 **@Valid 기능을 흉내 내기 위해 직접 Validator를 사용하는 것**.

---

# 🧠 핵심 요약

|항목|역할|
|---|---|
|`@Valid`|검증을 수행하라고 스프링에게 알려주는 _지시자_|
|`Validator`|실제로 DTO를 검사하는 _엔진_|
|Spring MVC|@Valid 감지 → Validator 호출 → 검증 결과 처리|
