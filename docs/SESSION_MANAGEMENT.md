# Session Management Guide

By default, FAST sessions are ephemeral — the session ID lives only in React state, so refreshing the page or logging out loses the conversation. To let users resume past conversations, two things are needed: a place where conversations live, and an API the frontend can call to list and read them.

---

## The Shape That Doesn't Change

Whichever storage pattern you pick, the wiring looks the same:

- An **API Gateway endpoint** protected by Cognito
- A **Lambda** that reads from the chosen store
- A **frontend service** that calls the API and powers a sidebar

The minimum endpoints are:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions` | List sessions for the authenticated user |
| `GET` | `/sessions/{id}` | Return a session's conversation history |
| `DELETE` | `/sessions/{id}` | Remove a session |

There is no `POST /sessions`. New sessions start implicitly the first time the agent runs with a fresh session ID, generated client-side via `crypto.randomUUID()`. The agent itself does the writing inside the runtime — the same way it already writes to AgentCore Memory today. The API only reads.

---

## Three Patterns

### Pattern 1: AgentCore Memory Only

Use the memory resource the agent already writes to. The Lambda calls `ListSessions` and `ListEvents` from the AgentCore data plane to power the sidebar and load history, plus `DeleteEvent` for deletion. No new storage to manage.

#### API Calls

`ListSessions` — list a user's sessions:

```python
client.list_sessions(memoryId=MEMORY_ID, actorId=user_sub)
# {
#   "sessionSummaries": [
#     {"sessionId": "...", "actorId": "...", "createdAt": <datetime>},
#     ...
#   ],
#   "nextToken": "..."  # when paginated
# }
```

`ListEvents` — read a session's history:

```python
client.list_events(
    memoryId=MEMORY_ID,
    actorId=user_sub,
    sessionId=session_id,
    includePayloads=True,
)
# {
#   "events": [
#     {
#       "eventId": "...",
#       "eventTimestamp": <datetime>,
#       "payload": [
#         {"conversational": {"role": "USER", "content": {"text": "..."}}}
#       ],
#     },
#     ...
#   ],
#   "nextToken": "..."
# }
```

Events come back newest-first.

`DeleteEvent` — delete events from a session:

```python
client.delete_event(
    memoryId=MEMORY_ID,
    actorId=user_sub,
    sessionId=session_id,
    eventId=event_id,
)
```

To delete a full session, page through `ListEvents` and call `DeleteEvent` on each. The session summary remains in `ListSessions` afterwards — there is no API to remove it, so a fully "deleted" session needs to be masked out-of-band (for example, in DynamoDB).

#### Limitations

- AgentCore Memory is short-term — events expire after the `eventExpiryDuration` configured on the memory resource. Past that horizon, the conversation is gone.
- Listing results are ordered by `sessionId`, not recency. Session summaries don't carry a name or last-activity field, so the Lambda needs an extra `ListEvents` call per session to derive a title and sort the sidebar.

#### Best Fit

Short-lived apps, prototypes, or experiences where the sidebar only needs to surface recent sessions within the configured retention window.

---

### Pattern 2: AgentCore Memory + DynamoDB

Keep AgentCore Memory as the agent's runtime memory and add a DynamoDB table next to it. The agent still writes to Memory exactly as before — DynamoDB is a second store that the API reads from, not a replacement for Memory.

Two reasonable flavors:

| Flavor | DynamoDB Stores | Conversation Source | Use When |
|--------|----------------|--------------------| ---------|
| **Metadata only** | Session name, last-activity, status, custom fields | `ListEvents` from Memory | You want a fast, sortable sidebar but conversations fit within Memory's retention |
| **Full duplication** | Metadata + full conversation history | DynamoDB directly | You need conversations to outlive Memory's `eventExpiryDuration`, or want a durable record |

In both flavors the agent and the API stay decoupled — the agent doesn't know DynamoDB exists. Some other process (the runtime, a stream hook, or the Lambda itself on first read) populates it. The frontend reads from DynamoDB through the API.

#### Data Model (Metadata Flavor)

```
Table: {stack_name_base}-Sessions
├── Partition Key: userId (String)    — Cognito user sub
├── Sort Key: sessionId (String)      — UUID generated client-side
├── Attributes:
│   ├── name (String)                 — Display name
│   ├── status (String)               — "active" | "completed" | "cancelled"
│   ├── createdAt (String)            — ISO 8601
│   ├── updatedAt (String)            — ISO 8601 (last activity)
│   └── metadata (Map)               — Application-specific data
```

**Why userId as partition key?** Each user only queries their own sessions. This gives efficient `Query` operations without a GSI.

#### Best Fit

Production applications where you need durable session metadata, fast sidebar listing sorted by recency, or session data that outlives Memory's retention window.

---

### Pattern 3: Skip AgentCore Memory

Drop AgentCore Memory and use your own storage as the agent's memory system. The agent reads and writes session state to that store on every turn — the storage *is* the conversation history, not a parallel copy of it.

Strands makes this straightforward with its [`S3SessionManager`](https://strandsagents.com/docs/user-guide/concepts/agents/session-management/#s3sessionmanager--s3storage), which loads and persists session state to an S3 prefix on each invocation:

```python
from strands import Agent
from strands.session import S3SessionManager

agent = Agent(
    model=model,
    tools=tools,
    session_manager=S3SessionManager(
        bucket_name="my-sessions-bucket",
        prefix="sessions/",
        session_id=session_id,
    ),
)
```

A DynamoDB-backed equivalent works the same way. The Lambda powering the API reads from the same store the agent uses.

#### Best Fit

When you don't want to operate a Memory resource at all, or when you'd rather keep all conversation state in storage your team already manages.

---

## Picking a Pattern

| Consideration | Memory Only | Memory + DDB | Skip Memory |
|---------------|-------------|--------------|-------------|
| New infrastructure | None | DynamoDB table | S3 bucket or DDB table |
| Sidebar speed | Slow (extra API calls per session) | Fast (single Query) | Fast (direct read) |
| Session retention | Limited by `eventExpiryDuration` | Unlimited | Unlimited |
| Custom metadata (name, status) | No | Yes | Yes |
| Complexity | Low | Medium | Medium |

Start with **Memory-only** if your retention horizon fits the configured expiry and your sidebar needs are basic. Add **DynamoDB** when you need durable session metadata or fast listing. **Skip Memory** entirely if your framework already persists state where you want it.

In all three cases the API contract, the Lambda's role, and the frontend stay the same. Only the Lambda's data source changes.

---

## Frontend Pieces

The same set of pieces applies regardless of pattern:

1. **A service module** that calls the three endpoints (`GET /sessions`, `GET /sessions/{id}`, `DELETE /sessions/{id}`)
2. **A sidebar component** that lists sessions and triggers resume on click
3. **A resume handler** that loads the chosen session's history and reuses its session ID for follow-up messages
4. **A "new chat" handler** that generates a fresh session ID and clears the panel

### Session Resumption

When resuming a session, the key insight is that the agent's session manager (whether AgentCore Memory, S3, or DDB) stores conversation history keyed by session ID. You don't need to re-send past messages. Simply:

1. Set the `runtimeSessionId` to the existing session's ID
2. Send the new user message
3. The session manager loads prior context automatically

### Session Naming

| Strategy | Implementation | Quality |
|----------|---------------|---------|
| **First message truncation** | `message.slice(0, 50)` | Low — often not descriptive |
| **LLM-generated title** | Ask the model after first exchange | High — adds latency/cost |
| **User-provided** | Rename option in sidebar | Highest — requires user action |

---

## Implementation Reference: DynamoDB + API Gateway

This section provides concrete infrastructure guidance for Pattern 2. The implementation follows the same patterns as the existing FAST Feedback API (`infra-cdk/lambdas/feedback/`).

### CDK: DynamoDB Table

```typescript
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

const sessionsTable = new dynamodb.Table(this, "SessionsTable", {
  tableName: `${config.stack_name_base}-Sessions`,
  partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "sessionId", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  encryption: dynamodb.TableEncryption.AWS_MANAGED,
  pointInTimeRecovery: true,
});
```

### CDK: API Gateway Routes

Add session routes to the existing REST API, protected by the Cognito authorizer:

```typescript
const sessionsResource = api.root.addResource("sessions");
const sessionByIdResource = sessionsResource.addResource("{sessionId}");

sessionsResource.addMethod("GET", sessionsLambdaIntegration, {
  authorizer: cognitoAuthorizer,
  authorizationType: apigateway.AuthorizationType.COGNITO,
});
sessionByIdResource.addMethod("GET", sessionsLambdaIntegration, {
  authorizer: cognitoAuthorizer,
  authorizationType: apigateway.AuthorizationType.COGNITO,
});
sessionByIdResource.addMethod("DELETE", sessionsLambdaIntegration, {
  authorizer: cognitoAuthorizer,
  authorizationType: apigateway.AuthorizationType.COGNITO,
});
```

Follow the existing Feedback API pattern for CORS configuration and Lambda integration. See `infra-cdk/lib/backend-stack.ts` for the full reference.

### Lambda Handler

Create `infra-cdk/lambdas/sessions/index.py` following the Powertools pattern used by the Feedback Lambda. The handler should:

- Use `APIGatewayRestResolver` with CORS config from environment
- Extract `userId` from `request_context.authorizer.claims["sub"]`
- Query DynamoDB with `userId` as partition key
- Return sessions sorted by `updatedAt` descending

See `infra-cdk/lambdas/feedback/index.py` for the exact patterns to follow (imports, CORS setup, Cognito claims extraction, error handling).

### SSM Parameter

Store the API URL for cross-stack access:

```typescript
new ssm.StringParameter(this, "SessionsApiUrlParam", {
  parameterName: `/${config.stack_name_base}/sessions-api-url`,
  stringValue: api.url,
});
```

### Cost

| Resource | Cost | Notes |
|----------|------|-------|
| DynamoDB (on-demand) | ~$0.625 per million writes, ~$0.125 per million reads | Negligible for most apps |
| API Gateway | $3.50 per million requests | Shared with other routes |
| Lambda | Free tier covers 1M requests/month | Minimal compute |

For most GenAI applications, these costs are negligible — token usage dominates.

---

## Advanced: Long-Running Agent Sessions

For agents that run autonomously for extended periods (minutes to hours), session management becomes more complex. Consider:

- **Status tracking** — Extend DynamoDB with `status`, `detail`, `lastHeartbeat` fields. Agent writes progress updates during execution.
- **Polling** — If the agent runs longer than SSE connection timeout (~60–90s on AgentCore), the frontend polls `GET /sessions/{id}` for progress instead of streaming.
- **Cancellation** — Frontend sets `status: "cancelled"` in DynamoDB. Agent checks before each tool call and stops gracefully.
- **Streaming to S3** — Agent writes detailed output to S3 (JSONL format) for the frontend to consume independently of the session metadata.

---

## Further Reading

- [Strands S3SessionManager](https://strandsagents.com/docs/user-guide/concepts/agents/session-management/#s3sessionmanager--s3storage)
- AgentCore Memory data plane: `CreateEvent`, `ListSessions`, `ListEvents`, `DeleteEvent`
- [FAST Memory Integration Guide](./MEMORY_INTEGRATION.md)
- [FAST Streaming Guide](./STREAMING.md)
- [FAST Deployment Guide](./DEPLOYMENT.md)
