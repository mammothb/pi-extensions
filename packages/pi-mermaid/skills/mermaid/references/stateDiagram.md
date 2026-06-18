# State Diagram Reference

## Syntax

```
stateDiagram-v2
    [*] --> StateName
    StateName --> AnotherState : Transition label
    AnotherState --> [*]

    state CompositeState {
        [*] --> InnerState
        InnerState --> [*]
    }
```

Use `stateDiagram-v2` (new renderer). Avoid bare `stateDiagram` (old renderer).

## Special States

| Syntax | Meaning |
|--------|---------|
| `[*]` | Start or end state |
| `state X <<choice>>` | Decision point |
| `state X <<fork>>` | Fork |
| `state X <<join>>` | Join |

## Composite States

```
state First {
    [*] --> second
    second --> [*]
}
```

Can nest multiple levels. Transitions between composite states are allowed, but transitions between internal states of different composite states are NOT.

## Concurrency

Separate concurrent regions within a composite state with `--`:
```
state Active {
    [*] --> Region1
    Region1 --> [*]
    --
    [*] --> Region2
    Region2 --> [*]
}
```

## Notes

```
note right of StateName
    Text here
end note

note left of StateName : Short note
```

## Direction

```
stateDiagram-v2
    direction LR
```

## Styling

```
classDef highlight fill:#f9f,stroke:#333
class StateName highlight
```

Or inline: `StateName:::highlight`

## Common Pitfalls

| Problem | Cause | Fix |
|---------|-------|-----|
| Old renderer issues | Using `stateDiagram` instead of `stateDiagram-v2` | Always use `stateDiagram-v2` |
| Transition between internal states of different composites | Not supported | Flatten or restructure |
| `classDef` not applied | Applied to start/end states or composite states | `classDef` cannot style `[*]` or composite states |
| Missing `[*]` | Diagram has no start or end | Add `[*] --> FirstState` and `LastState --> [*]` |
| Choice without branches | `<<choice>>` state with only one outgoing transition | Must have at least two outgoing transitions |

## Naming Conventions

- State names: PascalCase or descriptive labels (`Idle`, `Processing`, `AwaitingPayment`)
- Transition labels: short descriptions (`timeout`, `onSuccess`, `evPress`)
