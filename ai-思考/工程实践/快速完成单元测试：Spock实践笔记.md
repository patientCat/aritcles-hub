# 快速完成单元测试：Spock 实践笔记

## 0. 珠玉在前
- [美团实践文章](https://tech.meituan.com/2021/08/06/spock-practice-in-meituan.html)
- 书籍推荐：《Java Testing with Spock》

## 1. 背景
我从 2021 年 9 月开始切到 Java。经历了从“代码很丑、规范不熟”到“逐步形成自己的风格”的过程。大约 7 个多月里，累计写了 20k+ 代码，编码习惯从基础 Java 演进到 Java 8，并配合 Guava + Apache Commons 等工具。

测试风格也从 JUnit + Mockito，逐步迁移到 Spock。中间还补了设计模式与 DDD 思路。本文主要想分享：**如何用 Spock 更快写出“好用”的单元测试**。

![](https://km.woa.com/asset/4e88d089959d4481a3bb3fe185a0b5a8?height=410&width=854)

### 1.1 关于单元测试想说的话
我不想讨论“要不要写单测”——这是团队与个人风格问题。这里只讨论：
1. 如何快速完成单测
2. 如何让单测反哺代码质量

单测在我这边最直接的两个收益：
1. **提升代码质量**：写测试会倒逼你写出更可测试、更清晰的代码。
2. **加快开发节奏**：提前把测试场景写进方案，很多逻辑问题可以在本地快速闭环，减少反复走 CI/CD 的成本。

---

## 2. Quick Start
Spock 基础介绍可先参考上面的文章和书，这里直接上手。

### 2.1 given-when-then
下面用 Java 8 的 `DateTimeFormatter` 举一个最小示例：

```groovy
def "DataTimeFormatter: #expectedNoException"(){
    given:"设定 Pattern"
    def patternyyyyMMdd = "yyyy-MM-dd"
    def patternYYYYMMdd = "YYYY-MM-dd"
    def patternMMddyyyy = "MM-dd-yyyy"

    when: "调用 DateTimeFormatter"
    LocalDateTime localDateTime = LocalDateTime.now();
    DateTimeFormatter formatnyyyyMMdd = DateTimeFormatter.ofPattern(patternyyyyMMdd);
    def yyyyMMDD = localDateTime.format(formatnyyyyMMdd)
    DateTimeFormatter formatYYYYMMdd = DateTimeFormatter.ofPattern(patternYYYYMMdd);
    def YYYYMMDD = localDateTime.format(formatYYYYMMdd)
    DateTimeFormatter formatMMddyyyy = DateTimeFormatter.ofPattern(patternMMddyyyy);
    def MMddyyyy = localDateTime.format(formatMMddyyyy)

    then: "验证结果"
    println(yyyyMMDD)
    println(YYYYMMDD)
    println(MMddyyyy)
}
```

对初学者来说，`given-when-then` 是最好用的思维骨架：
1. `given`：准备输入和上下文
2. `when`：执行被测行为
3. `then`：断言结果

示例里的字符串说明并非必须，但我建议保留：**好的单测就是代码说明书**。

---

## 3. 正式开始：一个真实业务案例
下面是我实际遇到的场景：按国家行政区划编码查询。

如果你不熟悉行政区划编码，可参考：
[中华人民共和国行政区划代码](http://www.mca.gov.cn/article/sj/xzqh/2020/20201201.html)

编码规则简化为：
1. 1-2 位：省
2. 3-4 位：市
3. 5-6 位：县

需要支持的查询：
1. 查询全国所有省
2. 查询全国所有市
3. 查询全国所有县
4. 查询全国所有省市县
5. 查询某省下所有市
6. 查询某省下所有市和县
7. 查询某市下所有县

我不想在 Controller 暴露 7 个接口，于是在 Service 层抽成一个通用接口：`code + mask`。

| Scene | Code | Mask |
| :---- | :---- | :---- |
| 查询所有省 | 000000 | 100 |
| 查询所有市 | 000000 | 010 |
| 查询所有县 | 000000 | 001 |
| 查询所有省市县 | 000000 | 111 |
| 查询某省下市和县 | ??0000 | 011 |
| 查询某省下市 | ??0000 | 010 |
| 查询某省下县 | ??0000 | 001 |
| 查询某市下县 | ????00 | 001 |

本质上，这类需求最终会归结为“生成一个可匹配的正则 / Predicate”。

先写伪测试，再写实现（TDD 思路）：

```groovy
def "伪代码"():
  given: "设置参数"
  def code1 = "000000"
  def mask1 = "100"
  def expectCode = "120000"

  when: "执行"
  def condition1 = areaCodeService.getQueryCondition(code1, mask1)

  then: "校验"
  condition1.test(expectCode) == true
```

### 3.1 先建 AreaCodeModel

Collaborate Class:

```java
@Data
@AllArgsConstructor
@NoArgsConstructor
public class AreaCodeModel {
    public static final int VALID_CODE_LENGTH = 6;
    private static final int VALID_CODE_SORT = 3;
    public static final String DEFAULT_CODE = "000000";

    protected String province = "00";
    protected String municipal = "00";
    protected String county = "00";

    private static String getProvince(String code){
        return StringUtils.substring(code, 0, 2);
    }

    private static String getMunicipal(String code){
        return StringUtils.substring(code, 2, 4);
    }

    private static String getCounty(String code){
        return StringUtils.substring(code, 4, 6);
    }

    private static List<String> spiltCode2List(String code){
        List<String> codeList = Lists.newArrayList();
        codeList.add(getProvince(code));
        codeList.add(getMunicipal(code));
        codeList.add(getCounty(code));
        return codeList;
    }

    public static Boolean isValidCode(String code){
        if(code.length() != VALID_CODE_LENGTH){
            return false;
        }
        List<String> stringList = spiltCode2List(code);
        if(stringList.size() != VALID_CODE_SORT){
            return false;
        }
        return true;
    }

    public static AreaCodeModel of(String code){
        if(!isValidCode(code)){
            throw new RuntimeException("非法的code");
        }
        List<String> stringList = spiltCode2List(code);
        return new AreaCodeModel(stringList.get(0), stringList.get(1), stringList.get(2));
    }

    public String getCode(){
        List<String> codeList = Lists.newArrayList(this.province, this.municipal, this.county);
        return Joiner.on(StringUtils.EMPTY).join(codeList);
    }
}
```

对应 Spock 测试：

```groovy
def "测试AreaCodeModel"(){
    given: "给定正确的 Model"
    def model1 = "112200"
    def model2 = "112990"
    def model3 = "123311"

    when : "执行"
    def result1 = AreaCodeModel.of(model1)
    def result2 = AreaCodeModel.of(model2)
    def result3 = AreaCodeModel.of(model3)

    then : "验证"
    result1.getCode().size() == AreaCodeModel.VALID_CODE_LENGTH
    result1.getCode() == model1
    result2.getCode().size() == AreaCodeModel.VALID_CODE_LENGTH
    result2.getCode() == model2
    result3.getCode().size() == AreaCodeModel.VALID_CODE_LENGTH
    result3.getCode() == model3
}
```

夹带一点个人习惯：
1. 我偏好富血模型：模型可覆盖的规则尽量收拢在模型内部。
2. 用 `@link` 在实现和测试之间互相标注，回查更快。

---

### 3.2 where：参数化测试
如果要测 100 组输入，显然不能复制 100 份。

`where` 标签可以把“输入-输出”表格化。

```groovy
@Unroll
def "测试AreaCodeModel with Where 标签"(){
    given: "给定测试参数"

    when : "执行"
    def result = AreaCodeModel.of(testModel)
    def isValid = result.getCode().size() == AreaCodeModel.VALID_CODE_LENGTH
    throw new RuntimeException("")

    then :
    def exception = thrown(RuntimeException)
    exception.getMessage() == expectedMessge
    isValid == expectResult

    where : "分类测试"
    testModel || expectResult | expectedMessge
    "111111"  || true         | ""
    "101111"  || true         | ""
    "110111"  || true         | ""
    "111011"  || true         | "1"
    "1111111" || null         | "非法的code"
    "11111"   || null         | "非法的code"
}
```

补充三点：
1. 新版 Spock 默认就会把 where 的每一行独立展示，`@Unroll` 不再强依赖，但保留也没问题。
2. `thrown` 适合异常断言；如果同一个用例里既要覆盖正常分支又要覆盖异常分支，拆测试通常更清晰。
3. `where` 里的表头变量直接使用即可，不需要提前定义。

---

### 3.3 生成 Predicate 的测试
这个场景下，核心其实是“输入 code + mask，输出匹配逻辑是否正确”。

```groovy
def "测试正则模糊查询"(){
    given:
    def querySupport = new AreaCodeQueryPatternSupport()
    querySupport.init()
    def areaCodeDomain = new AreaCodeAggregate(testCode, testMask, querySupport)

    when:
    def predicate = areaCodeDomain.generatePatternPredicate();
    def matches = predicate.test(dbCode)

    then:
    matches == expectedResult

    where:
    testCode | testMask | dbCode || expectedResult
    "000000" | "111" | "130130" || true

    // 查询省
    "000000" | "100" | "110000" || true
    "110000" | "100" | "110000" || true
    "110000" | "100" | "111100" || false

    // 查询所有市
    "000000" | "010" | "102200" || true
    "001100" | "010" | "112200" || true
    "000000" | "010" | "110000" || false
    "000000" | "010" | "110002" || false

    // 查询某个 11 省下面的市
    "110000" | "010" | "112200" || true
    "111100" | "010" | "112200" || true
    "110000" | "010" | "110000" || false
    "110000" | "010" | "110102" || false

    // 查询某个 11 省下面的市和县
    "110000" | "011" | "112200" || true
    "111100" | "011" | "112200" || true
    "111100" | "011" | "112201" || true
}
```

---

## 4. 小结
我的经验是：
1. **先写场景，再写实现**（用伪测试先把问题钉住）
2. **善用 where 做参数化**（减少重复、提升可读性）
3. **测试不仅是校验，更是设计反馈**（你会自然写出更可维护的代码）

## 源代码
- https://github.com/patientCat/quick_spock

---

![](https://luke-1307356219.cos.ap-chongqing.myqcloud.com/%E5%85%AC%E8%80%83/%E5%85%AC%E4%BC%97%E5%8F%B7.jpg)
