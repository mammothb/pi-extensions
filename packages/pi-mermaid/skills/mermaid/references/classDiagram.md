# Class Diagram Reference

## Syntax

```
classDiagram
    direction RL

    class ClassName {
        +String attribute
        -int privateAttr
        +method() bool
    }

    ClassName <|-- SubClass : Inheritance
    ClassName *-- Member : Composition
    ClassName o-- Aggregate : Aggregation
    ClassName --> Related : Association
    ClassName ..> Dependent : Dependency
    ClassName ..|> Realization
```

## Relationship Types

| Symbol | Meaning |
|--------|---------|
| `<\|--` | Inheritance (is-a) |
| `*--` | Composition (has-a, owns lifecycle) |
| `o--` | Aggregation (has-a, shared) |
| `-->` | Association |
| `..>` | Dependency |
| `..\|>` | Realization |
| `--` | Solid link |
| `..` | Dashed link |

Reverse the arrow for opposite direction (e.g., `Base --|> Sub`).

Add labels with `: LabelText`:
```
Customer "1" --> "*" Order : places
```

## Visibility

| Symbol | Meaning |
|--------|---------|
| `+` | Public |
| `-` | Private |
| `#` | Protected |
| `~` | Package/Internal |

## Annotations

```
class Shape <<interface>>
class Color <<enumeration>>
class Service <<Service>>
```

## Cardinality

Place before or after the arrow:
```
Customer "1" --> "0..*" Order : places
```

| Notation | Meaning |
|----------|---------|
| `1` | Exactly one |
| `0..1` | Zero or one |
| `1..*` | One or more |
| `*` | Many |

## Namespaces

Groups classes logically:
```
namespace Auth {
    class UserService
    class TokenService
}
```

## Common Pitfalls

| Problem | Cause | Fix |
|---------|-------|-----|
| Parse error | Missing space in relationship | `A <\|-- B` not `A<\|--B` |
| No rendering | Used `graph` instead of `classDiagram` | Always use `classDiagram` |
| Generic type parsing | Comma inside generics | Mermaid doesn't support `List<K,V>`. Flatten or use `~` notation |
| Duplicate class names | Two classes with same name but different generic types | Not supported. Use distinct names |
| Visibility on wrong side | `-` placed after type | Visibility goes before name: `-int age` not `int -age` |

## Naming Conventions

- Class names: PascalCase (`BankAccount`, `UserService`)
- Attributes: camelCase (`firstName`, `accountBalance`)
- Methods: camelCase with parens (`deposit(amount)`, `isValid()`)
