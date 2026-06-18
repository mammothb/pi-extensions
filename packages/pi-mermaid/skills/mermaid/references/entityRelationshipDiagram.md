# Entity Relationship Diagram Reference

## Syntax

```
erDiagram
    ENTITY1 ||--o{ ENTITY2 : relationshipLabel
    ENTITY1 {
        type attributeName PK
        type attributeName FK
        type attributeName UK "Optional comment"
    }
```

## Cardinality

| Left | Right | Meaning |
|------|-------|---------|
| `\|o` | `o\|` | Zero or one |
| `\|\|` | `\|\|` | Exactly one |
| `}o` | `o{` | Zero or more |
| `}\|` | `\|{` | One or more |

Aliases: `zero or one`, `one or more`, `many(1)`, `1+`, `only one`, `1`.

## Identification

| Symbol | Meaning |
|--------|---------|
| `--` | Identifying relationship (solid line) |
| `..` | Non-identifying relationship (dashed line) |

Aliases: `to` (= identifying), `optionally to` (= non-identifying).

## Attributes

```
ENTITY {
    type name key "comment"
}
```

Key types: `PK` (Primary Key), `FK` (Foreign Key), `UK` (Unique Key). Multiple keys: `PK, FK`.

Nullable types: `string? name`

## Direction

```
erDiagram
    direction LR
```

Orientations: `TB`, `BT`, `LR`, `RL`.

## Entity Aliases

```
p[Person] {
    string firstName
}
```

## Subgraphs

```
subgraph "Customer Domain"
    CUSTOMER
    ORDER
end
```

## Styling

```
style ENTITY1 fill:#f9f,stroke:#333
classDef highlight fill:#f96
class ENTITY1 highlight
```

Or inline: `ENTITY1:::highlight`

## Common Pitfalls

| Problem | Cause | Fix |
|---------|-------|-----|
| Parse error on cardinality | Wrong order of symbols | `\|\|--o{` is correct. `o{--\|\|` is wrong |
| Relationship label doesn't show | Missing colon-space | `: places` not `:places` |
| Entity name with spaces | Unquoted name with spaces | Use quotes: `"Customer Order"` |
| Subgraph id with spaces | Unquoted subgraph id with spaces | Use quotes when referencing: `"Customer Domain" \|\|--o{ ORDER` |
| Missing attributes block closing | Forgot `}` | Every `{` needs matching `}` |

## Naming Conventions

- Entity names: UPPER_SNAKE_CASE or PascalCase singular (`CUSTOMER`, `Order`)
- Relationship labels: lowercase verbs (`places`, `contains`, `belongs to`)
- Attributes: camelCase (`firstName`, `orderTotal`)
