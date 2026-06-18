---
name: mermaid
description: Use Mermaid syntax for ALL diagrams. Never draw ASCII art. Use this skill whenever creating or editing any diagram — architecture, processes, data flows, API interactions, system topologies, decision trees, or any other visual structure.
---

# Mermaid Diagram Generator

Use Mermaid syntax for all diagramming needs. Never produce ASCII art diagrams. Output is a ` ```mermaid ` block ready for embedding in markdown documents.

## Absolute Rule: No ASCII

Never draw ASCII art diagrams. Not for quick sketches, not for simple flows, not for anything. Every diagram, chart, or visual structure must use Mermaid syntax. ASCII diagrams are unmaintainable, error-prone on edit, and invisible to tooling.

If a user asks for something Mermaid cannot express, explain the limitation and suggest alternatives. Never fall back to ASCII.

## Workflow

1. **Determine diagram type**: Choose from the supported types (see [Diagram Type Selection](#diagram-type-selection)).
2. **Read the reference**: Load the relevant reference doc from `references/` for syntax details and pitfalls. If the request involves architecture, also load `references/architecture.md` for patterns.
3. **Generate Mermaid code**: Produce syntactically correct Mermaid using the reference documentation.
4. **Validate**: Run `node scripts/validate.mjs` on the generated code. If validation fails, fix the errors and re-validate. Repeat until valid.
5. **Output**: Return ONLY the ` ```mermaid ` block and any brief explanation the user requested. Never include validation status (e.g., "Valid", "Validated", "Validation passed") in output — validation is an internal quality step, not user-facing information.

## Diagram Type Selection

| Scenario | Diagram Type | Reference |
|----------|-------------|-----------|
| Processes, decision trees, workflows | Flowchart | `flowchart.md` |
| System architecture, service topologies | Flowchart with subgraphs | `flowchart.md` |
| System context (actors + systems) | Flowchart LR | `flowchart.md` |
| API flows, auth sequences, message passing | Sequence Diagram | `sequenceDiagram.md` |
| Event chains, pub/sub delivery | Sequence Diagram | `sequenceDiagram.md` |
| Object-oriented design, domain models | Class Diagram | `classDiagram.md` |
| State machines, lifecycle stages | State Diagram | `stateDiagram.md` |
| Database schemas, entity relationships | Entity Relationship Diagram | `entityRelationshipDiagram.md` |
| Project timelines, roadmaps | Gantt Chart | `gantt.md` |
| Proportions, distributions | Pie Chart | `pie.md` |
| Hierarchies, brainstorming | Mindmap | `mindmap.md` |
| Chronological events, history | Timeline | `timeline.md` |
| Branch/merge history | Git Graph | `gitgraph.md` |
| C4 architecture (context, container) | C4 Diagram | `c4.md` |
| User flows, experience maps | User Journey | `userJourney.md` |

When uncertain: if the scenario involves a timeline of messages between named parties, use sequence. If it shows structure and relationships at a point in time, use flowchart. For domain models use class, for lifecycles use state, for database schemas use ER.

## Validation Loop

After generating Mermaid code, validate it before output:

```bash
echo '<mermaid-code>' | node scripts/validate.mjs
```

Or write to a temp file and validate:

```bash
node scripts/validate.mjs /tmp/diagram.mmd
```

The script outputs JSON:
- `{"valid": true}` — diagram is syntactically correct
- `{"valid": false, "error": "..."}` — fix the reported error and re-validate
- `{"valid": true, "warning": "Environment error ignored"}` — syntax is valid (Node environment limitation in mermaid)

**Do not output a diagram that has not passed validation.** Loop until valid. Never mention validation in output — just produce the diagram.

## Editing Existing Diagrams

When asked to modify an existing diagram, edit the Mermaid source directly rather than regenerating from scratch. Preserve existing node IDs and structure. Validate after editing. Never mention validation status in output.

The existing diagram may come from:
- A Mermaid block the user included in their message (read it from the conversation)
- A file path the user provided
- A diagram you generated earlier in the same conversation

If the user provides a ` ```mermaid ` block inline in their message, that IS the existing diagram — edit it directly. Do not ask for a file path when the diagram is already in front of you.

## Output Specification

Generated Mermaid code must:

1. Be wrapped in ` ```mermaid ` code blocks
2. Have correct syntax validated by `scripts/validate.mjs` — but never mention validation in output
3. Use semantic node IDs: `AuthService`, not `A`
4. Keep labels concise (under 40 characters)
5. Use `flowchart` (never `graph`) for flowcharts
6. Declare all participants before messages in sequence diagrams

When the user asks for a diagram to be saved to a file, write the Mermaid source (without the ` ```mermaid ` wrapper) to the requested `.mmd` file, then validate the file. Output the file path and the rendered diagram block.

## References

- **flowchart.md** — Flowchart syntax, node shapes, connections, subgraphs, pitfalls
- **sequenceDiagram.md** — Sequence syntax, participants, control structures, pitfalls
- **architecture.md** — Architecture diagram patterns using flowchart and sequence
- **classDiagram.md** — Class diagram syntax, relationships, annotations, pitfalls
- **stateDiagram.md** — State diagram syntax, transitions, composite states, pitfalls
- **entityRelationshipDiagram.md** — ER diagram syntax, cardinality, keys, pitfalls
- **gantt.md** — Gantt chart syntax, tasks, milestones, dependencies, pitfalls
- **pie.md** — Pie chart syntax, data format, pitfalls
- **mindmap.md** — Mindmap syntax, indentation, styling, pitfalls
- **timeline.md** — Timeline syntax, events, sections, pitfalls
- **gitgraph.md** — Git graph syntax, commits, branches, merges, pitfalls
- **c4.md** — C4 diagram syntax, context, container, component, code, pitfalls
- **userJourney.md** — User journey syntax, sections, tasks, actors, pitfalls
