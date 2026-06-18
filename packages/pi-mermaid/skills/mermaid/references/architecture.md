# Architecture Diagram Patterns

Use flowchart and sequence diagrams for architecture documentation. This reference shows how to map common architecture views to these two diagram types.

## Pattern Selection

| Architecture Need | Diagram Type | Rationale |
|------------------|--------------|-----------|
| System Context (who/what interacts) | Flowchart | Boxes for systems/actors, edges for relationships |
| Service Topology | Flowchart | Subgraphs for bounded contexts, edges for dependencies |
| Data Flow | Flowchart | Nodes for processing steps, edges for data movement |
| Deployment Topology | Flowchart | Subgraphs for hosts/environments, nested nodes for services |
| Request Tracing | Sequence | Lifelines for services, messages for calls |
| Auth Flows | Sequence | Participants for client/auth/resource, messages for tokens |
| Event Chains | Sequence | Messages with labels for event types |

## System Context (Flowchart)

```mermaid
flowchart LR
    User([User]) -->|Uses| App[Application]
    App -->|Reads/Writes| DB[(Database)]
    App -->|Sends Email| Email[Email Service]
    App -->|Processes Payment| Pay[Payment Gateway]
```

Key conventions:
- Use rounded shapes `([ ])` for human actors, rectangles `[ ]` for systems
- Use cylinder `[( )]` for databases
- Edge labels describe the relationship or data direction
- Left-to-right (`LR`) for system context with few nodes

## Service Topology (Flowchart with Subgraphs)

```mermaid
flowchart TD
    subgraph Frontend["Frontend Layer"]
        Web[Web App]
        Mobile[Mobile App]
    end
    subgraph Services["Service Layer"]
        Auth[Auth Service]
        API[API Gateway]
        Users[User Service]
        Orders[Order Service]
    end
    subgraph Data["Data Layer"]
        Cache[(Redis)]
        DB[(PostgreSQL)]
        Queue[Message Queue]
    end

    Web --> API
    Mobile --> API
    API --> Auth
    API --> Users
    API --> Orders
    Users --> Cache
    Users --> DB
    Orders --> DB
    Orders --> Queue
```

Key conventions:
- Subgraphs with semantic titles (Frontend, Services, Data)
- Layout from top to bottom (`TD`) for layered architectures
- Group related services in subgraphs
- Explicit edge labels for protocol or data direction when ambiguous

## API Request Flow (Sequence)

```mermaid
sequenceDiagram
    actor C as Client
    participant GW as API Gateway
    participant Auth as Auth Service
    participant Svc as Service
    participant DB as Database

    C->>GW: POST /api/orders
    GW->>Auth: Validate JWT
    Auth-->>GW: Valid
    GW->>Svc: CreateOrder(payload)
    Svc->>DB: INSERT INTO orders
    DB-->>Svc: OK
    Svc-->>GW: 201 Created
    GW-->>C: Response
```

Key conventions:
- Use `actor` for frontend/mobile clients, `participant` for backend services
- `->>` for synchronous calls, `-->>` for responses
- Label messages with HTTP method + path or function calls
- Keep lifeline ordering left-to-right = call depth

## Event-Driven Flow (Sequence)

```mermaid
sequenceDiagram
    participant P as Publisher
    participant Q as Message Queue
    participant C1 as Consumer A
    participant C2 as Consumer B

    P->>Q: Publish OrderPlaced
    Q-->>C1: Deliver OrderPlaced
    Q-->>C2: Deliver OrderPlaced
    C1->>C1: Process payment
    C2->>C2: Send notification
```

## Multi-Level Architecture (Flowchart)

For showing both deployment and service relationships:

```mermaid
flowchart TB
    subgraph Cloud["AWS Cloud"]
        subgraph LB["Load Balancer"]
            ALB[Application LB]
        end
        subgraph Compute["ECS Cluster"]
            Svc1[Service A]
            Svc2[Service B]
        end
        subgraph Storage["RDS"]
            DB[(PostgreSQL)]
        end
    end

    ALB --> Svc1
    ALB --> Svc2
    Svc1 --> DB
    Svc2 --> DB
```
