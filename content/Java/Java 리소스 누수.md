---
date: 2025-12-31
lastmod: 2025-12-31
tags:
draft: false
---
# Java 리소스 관리와 누수 방지  

## 리소스 누수란?  
  
**리소스 누수(Resource Leak)**는 프로그램이 사용한 시스템 리소스를 적절히 해제하지 않아 메모리나 리소스가 계속 점유되는 현상입니다.  
  
### 주요 리소스 타입  
- **파일 핸들**: InputStream, OutputStream, Reader, Writer  
- **네트워크 연결**: Socket, ServerSocket, URLConnection  
- **데이터베이스 연결**: Connection, Statement, ResultSet  
- **기타**: ValidatorFactory, EntityManagerFactory, 스레드 풀 등  
  
### 리소스 누수의 증상  
```java  
// ❌ 나쁜 예: 리소스 누수 발생  
public void readFile(String path) {  
    FileInputStream fis = new FileInputStream(path);    // 파일 읽기 작업...  
    // close()를 호출하지 않음!  
}  
  
// 이 메서드를 1000번 호출하면?  
// → 1000개의 파일 핸들이 열린 채로 유지됨  
// → "Too many open files" 에러 발생 가능  
```  
  
---  
  
## 리소스 관리가 필요한 이유  
  
### 1. **시스템 리소스는 한정적**  
```java  
// OS는 프로세스당 열 수 있는 파일 개수를 제한함  
// Linux: 기본 1024개  
// macOS: 기본 256개  
```  
  
### 2. **메모리 누수**  
```java  
// GC가 객체를 수거해도 네이티브 리소스는 남아있을 수 있음  
BufferedInputStream bis = new BufferedInputStream(new FileInputStream("data.txt"));  
bis = null; // 객체 참조는 사라짐  
// BUT: 파일 핸들은 여전히 OS에 남아있음!  
```  
  
### 3. **성능 저하**  
```java  
// 리소스 누수가 누적되면  
// - 메모리 부족  
// - 파일/소켓 연결 제한 도달  
// - 애플리케이션 응답 지연 또는 중단  
```  
  
---  
  
## try-with-resources 구문  
  
Java 7부터 도입된 안전한 리소스 관리 방법입니다.  
  
### 기본 문법  
```java  
try (ResourceType resource = new ResourceType()) {  
    // 리소스 사용  
} // 자동으로 close() 호출됨  
```  
  
### 전통적인 방법 vs try-with-resources  
  
#### ❌ 전통적인 방법 (Java 6 이전)  
```java  
FileInputStream fis = null;  
try {  
    fis = new FileInputStream("file.txt");    // 파일 읽기...  
} catch (IOException e) {  
    e.printStackTrace();} finally {  
    if (fis != null) {        try {            fis.close();        } catch (IOException e) {            e.printStackTrace();        }    }}  
// 문제점:  
// 1. 코드가 장황함  
// 2. finally 블록에서도 예외 처리 필요  
// 3. 실수로 close() 누락 가능  
```  
  
#### ✅ try-with-resources (Java 7+)  
```java  
try (FileInputStream fis = new FileInputStream("file.txt")) {  
    // 파일 읽기...  
} catch (IOException e) {  
    e.printStackTrace();}  
// 장점:  
// 1. 코드가 간결함  
// 2. close()가 자동 호출됨  
// 3. 예외 처리가 안전함  
```  
  
### 여러 리소스 관리  
```java  
// ✅ 여러 리소스를 세미콜론으로 구분  
try (FileInputStream fis = new FileInputStream("input.txt");  
     FileOutputStream fos = new FileOutputStream("output.txt");     BufferedReader br = new BufferedReader(new InputStreamReader(fis))) {    // 모든 리소스 사용  
    String line = br.readLine();    fos.write(line.getBytes());    } // br, fos, fis 순서로 자동 close() 호출됨  
```  
  
### 리소스 닫히는 순서  
```java  
try (Resource1 r1 = new Resource1();  
     Resource2 r2 = new Resource2();     Resource3 r3 = new Resource3()) {    // 사용...  
}  
// 닫히는 순서: r3 → r2 → r1 (역순)  
```  
  
---  
  
## AutoCloseable 인터페이스  
  
try-with-resources를 사용하려면 `AutoCloseable` 또는 `Closeable` 인터페이스를 구현해야 합니다.  
  
### AutoCloseable 인터페이스  
```java  
public interface AutoCloseable {  
    void close() throws Exception;}  
```  
  
### Closeable 인터페이스  
```java  
public interface Closeable extends AutoCloseable {  
    void close() throws IOException;}  
```  
  
### 차이점  
- `AutoCloseable`: 모든 타입의 예외를 던질 수 있음  
- `Closeable`: IOException만 던질 수 있음 (I/O 관련 리소스용)  
  
### 커스텀 리소스 만들기  
```java  
// ✅ AutoCloseable을 구현한 커스텀 리소스  
public class DatabaseConnection implements AutoCloseable {  
    private Connection connection;        public DatabaseConnection(String url) throws SQLException {  
        this.connection = DriverManager.getConnection(url);        System.out.println("연결 열림");  
    }        public void executeQuery(String sql) {  
        // 쿼리 실행...  
    }        @Override  
    public void close() throws SQLException {        if (connection != null && !connection.isClosed()) {            connection.close();            System.out.println("연결 닫힘");  
        }    }}  
  
// 사용  
try (DatabaseConnection db = new DatabaseConnection("jdbc:mysql://localhost/mydb")) {  
    db.executeQuery("SELECT * FROM users");} // 자동으로 close() 호출됨  
```  
  
---  
  
## 실전 예제  
  
### 1. ValidatorFactory 관리  
  
#### ❌ 잘못된 방법  
```java  
@BeforeEach  
void setUp() {  
    ValidatorFactory factory = Validation.buildDefaultValidatorFactory();  
    validator = factory.getValidator();  
    // factory.close() 호출 안 함 → 리소스 누수!  
}  
```  
  
#### ✅ 올바른 방법  
```java  
@BeforeEach  
void setUp() {  
    try (ValidatorFactory factory = Validation.buildDefaultValidatorFactory()) {  
        validator = factory.getValidator();  
    } // 자동으로 close() 호출됨  
}  
```  
  
### 2. 파일 읽기/쓰기  
  
#### ❌ 잘못된 방법  
```java  
public List<String> readLines(String path) throws IOException {  
    BufferedReader reader = new BufferedReader(new FileReader(path));    List<String> lines = new ArrayList<>();    String line;    while ((line = reader.readLine()) != null) {        lines.add(line);    }    return lines; // reader를 닫지 않음!  
}  
```  
  
#### ✅ 올바른 방법  
```java  
public List<String> readLines(String path) throws IOException {  
    try (BufferedReader reader = new BufferedReader(new FileReader(path))) {        List<String> lines = new ArrayList<>();        String line;        while ((line = reader.readLine()) != null) {            lines.add(line);        }        return lines;    } // 자동으로 close() 호출됨  
}  
  
// 또는 Java 8+의 Stream API 사용  
public List<String> readLines(String path) throws IOException {  
    try (Stream<String> lines = Files.lines(Paths.get(path))) {        return lines.collect(Collectors.toList());    }}  
```  
  
### 3. 데이터베이스 연결  
  
#### ❌ 잘못된 방법  
```java  
public List<User> getUsers() {  
    Connection conn = dataSource.getConnection();    Statement stmt = conn.createStatement();    ResultSet rs = stmt.executeQuery("SELECT * FROM users");        List<User> users = new ArrayList<>();  
    while (rs.next()) {        users.add(new User(rs.getString("name")));    }    return users; // rs, stmt, conn을 닫지 않음!  
}  
```  
  
#### ✅ 올바른 방법  
```java  
public List<User> getUsers() throws SQLException {  
    try (Connection conn = dataSource.getConnection();         Statement stmt = conn.createStatement();         ResultSet rs = stmt.executeQuery("SELECT * FROM users")) {                List<User> users = new ArrayList<>();  
        while (rs.next()) {            users.add(new User(rs.getString("name")));        }        return users;    } // rs, stmt, conn 순서로 자동 close()}  
```  
  
### 4. HTTP 클라이언트  
  
#### ✅ Spring의 RestTemplate (자동 관리)  
```java  
@Service  
public class ApiService {  
    private final RestTemplate restTemplate;  
    public ApiService(RestTemplate restTemplate) {  
        this.restTemplate = restTemplate;    }  
    public String callApi(String url) {  
        // RestTemplate이 내부적으로 리소스를 관리함  
        return restTemplate.getForObject(url, String.class);  
    }  
}  
```  
  
#### ✅ Apache HttpClient (수동 관리)  
```java  
try (CloseableHttpClient httpClient = HttpClients.createDefault();  
     CloseableHttpResponse response = httpClient.execute(new HttpGet(url))) {        HttpEntity entity = response.getEntity();  
    return EntityUtils.toString(entity);}  
```  
  
### 5. 이미지 처리  
  
#### ❌ 잘못된 방법  
```java  
public void processImage(String path) {  
    InputStream is = new FileInputStream(path);    BufferedImage image = ImageIO.read(is);    // 이미지 처리...  
    // is를 닫지 않음!  
}  
```  
  
#### ✅ 올바른 방법  
```java  
public void processImage(String path) throws IOException {  
    try (InputStream is = new FileInputStream(path)) {        BufferedImage image = ImageIO.read(is);        // 이미지 처리...  
    }}  
```  
  
---  
  
## Best Practices  
  
### 1. **항상 try-with-resources 사용**  
```java  
// ✅ AutoCloseable 리소스는 무조건 try-with-resources 사용  
try (Resource resource = new Resource()) {  
    // 사용  
}  
```  
  
### 2. **가능한 한 좁은 스코프에서 리소스 관리**  
```java  
// ❌ 나쁜 예  
InputStream is = new FileInputStream("file.txt");  
// ... 긴 코드 ...// ... 많은 로직 ...is.close(); // 닫는 것을 까먹을 수 있음  
  
// ✅ 좋은 예  
try (InputStream is = new FileInputStream("file.txt")) {  
    // 필요한 작업만 수행  
}  
```  
  
### 3. **리소스 재사용 패턴**  
```java  
// Connection Pool 사용  
@Configuration  
public class DataSourceConfig {  
    @Bean    public DataSource dataSource() {        HikariConfig config = new HikariConfig();        config.setJdbcUrl("jdbc:mysql://localhost/mydb");        config.setMaximumPoolSize(10);        return new HikariDataSource(config);    }}  
  
// 사용할 때마다 새로운 Connection을 가져오되,  
// 내부적으로는 풀에서 재사용됨  
try (Connection conn = dataSource.getConnection()) {  
    // 사용  
}  
```  
  
### 4. **Spring의 리소스 관리 활용**  
```java  
// Spring이 리소스를 관리하므로 try-with-resources 불필요  
@Service  
public class MyService {  
    private final EntityManager em;    private final RestTemplate restTemplate;        // Spring이 자동으로 관리  
    public MyService(EntityManager em, RestTemplate restTemplate) {        this.em = em;        this.restTemplate = restTemplate;    }}  
```  
  
### 5. **테스트에서 리소스 관리**  
```java  
@SpringBootTest  
class MyServiceTest {  
    @BeforeEach  
    void setUp() {  
        // ValidatorFactory처럼 try-with-resources 사용  
        try (ValidatorFactory factory = Validation.buildDefaultValidatorFactory()) {  
            validator = factory.getValidator();  
        }  
    }  
    @Test  
    void testWithTempFile() throws IOException {  
        // 임시 파일도 try-with-resources로 관리  
        Path tempFile = Files.createTempFile("test", ".txt");  
        try (BufferedWriter writer = Files.newBufferedWriter(tempFile)) {  
            writer.write("test data");  
        }  
        // 테스트 후 정리  
        Files.deleteIfExists(tempFile);  
    }  
}  
```  
  
### 6. **예외 발생 시에도 안전하게**  
```java  
try (FileInputStream fis = new FileInputStream("input.txt");  
     FileOutputStream fos = new FileOutputStream("output.txt")) {        byte[] buffer = new byte[1024];  
    int length;    while ((length = fis.read(buffer)) > 0) {        fos.write(buffer, 0, length);    }    // 만약 여기서 예외 발생해도  
    // fos, fis는 자동으로 닫힘!  
    } catch (IOException e) {  
    log.error("파일 처리 중 오류 발생", e);  
}  
```  
  
---  
  
## 리소스 누수 감지 도구  
  
### 1. IDE 경고  
```java  
// IntelliJ IDEA, Eclipse 등은 자동으로 경고 표시  
FileInputStream fis = new FileInputStream("file.txt"); // ⚠️ Warning: Resource 'fis' is never closed  
```  
  
### 2. Static Analysis 도구  
- **SpotBugs**: 리소스 누수 패턴 감지  
- **SonarQube**: 코드 품질 분석  
- **Error Prone**: 컴파일 타임 버그 감지  
  
### 3. JProfiler, VisualVM  
- 런타임에 열린 파일 핸들, 소켓 등을 모니터링  
  
---  
  
## 요약  
  
### 핵심 원칙  
1. **AutoCloseable 리소스는 반드시 닫아야 함**  
2. **try-with-resources를 기본으로 사용**  
3. **리소스는 가능한 한 좁은 스코프에서 관리**  
4. **Spring 같은 프레임워크의 리소스 관리 기능 활용**  
  
### 체크리스트  
- [ ] 파일 I/O 작업에 try-with-resources 사용하는가?  
- [ ] 데이터베이스 Connection, Statement, ResultSet을 제대로 닫는가?  
- [ ] HTTP 클라이언트의 응답을 제대로 닫는가?  
- [ ] ValidatorFactory, EntityManagerFactory 등을 제대로 닫는가?  
- [ ] IDE의 리소스 누수 경고를 무시하지 않는가?  
  
### 참고 자료  
- [Oracle Java Tutorials - The try-with-resources Statement](https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html)  
- [Effective Java (3rd Edition) - Item 9: Prefer try-with-resources to try-finally](https://www.oreilly.com/library/view/effective-java/9780134686097/)  
- [Baeldung - Java Try with Resources](https://www.baeldung.com/java-try-with-resources)