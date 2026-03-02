# AgentCore M2M Authentication Workflow
**Runtime <--> OAuth Provider <--> Cognito <--> Gateway**

This document describes the complete workflow for how the AgentCore Runtime uses an OAuth2 Credential Provider (managed by AgentCore Identity) to obtain a Cognito M2M token and authenticate requests to the AgentCore Gateway. It is split into two phases: **Deployment** (infrastructure setup) and **Runtime** (live token and request flow).

## Background: The Two Secrets

The authentication workflow involves two secrets:

**Secret 1:** `/<stack-name>/machine_client_secret`
- Created by: CDK (`secretsmanager.Secret`)

**Secret 2:** `bedrock-agentcore-identity!default/oauth2/<stack-name>-runtime-gateway-auth`
- Created by: `oauth2ProviderLambda` Custom Resource during deployment

Secret 1 is created via `secretsmanager.Secret` and populated from the Cognito machine client's generated secret. Secret 2 is created by the `oauth2ProviderLambda` during deployment using `secretsmanager:CreateSecret` and `secretsmanager:PutSecretValue`.

**Note:** The `bedrock-agentcore-identity!default/oauth2/<stack-name>-runtime-gateway-auth` namespace is the AgentCore Identity convention for OAuth2 credentials in the default Token Vault, derived from this stack's implementation.

## Background: The Three IAM Roles

1. **AgentCoreRole**
   - Created in: CDK construct `createAgentCoreRuntime()`
   - Assumed by: AgentCore Runtime

2. **GatewayRole**
   - Created in: `createAgentCoreGateway()`
   - Assumed by: AgentCore Gateway service

3. **oauth2ProviderLambda Role**
   - Created by: CDK (auto-generated for Lambda function)
   - Assumed by: `oauth2ProviderLambda` function

The `GatewayRole` uses `new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com")` as its trust principal.

## Important: User Auth vs. M2M Auth -- They Are Separate

The stack contains two distinct authentication flows that are independent of each other. Both use the same Cognito User Pool but serve different purposes.

**Flow 1 -- Human User --> AgentCore Runtime (inbound to Runtime):**
- Uses the human-facing Cognito app client (`userPoolClientId`)
- Configured on the Runtime via `RuntimeAuthorizerConfiguration.usingJWT(...)` pointing to the User Pool discovery URL
- Uses the Authorization Code grant (human login via frontend)
- The user's JWT token (including their `sub` claim) is passed to the Runtime and made available to agent code via the allowlisted `Authorization` header (`requestHeaderConfiguration`)

**Flow 2 -- AgentCore Runtime --> AgentCore Gateway (M2M, outbound from Runtime):**
- Uses the `machineClient` — a separate Cognito app client with `clientCredentials: true` and `generateSecret: true`
- Uses the Client Credentials grant (no human user involved)
- The M2M token is obtained by the Runtime via AgentCore Identity's Token Vault and used to authenticate calls to the Gateway
- No user identity is involved in this flow at any point

The two flows are parallel, not nested:

```
Human User
    --> Cognito (Authorization Code, userPoolClientId)
    --> User JWT token
    --> AgentCore Runtime (validates via userPoolClientId authorizer)
    --> Agent code runs...
        --> Needs to call Gateway
        --> AgentCore Identity Token Vault (Client Credentials, machineClient)
        --> Cognito issues M2M JWT (machineClient.userPoolClientId)
        --> AgentCore Gateway (validates via machineClient.userPoolClientId authorizer)
        --> Tool Lambda
```

The user's Cognito pool and the machine client both use the same Cognito User Pool for CDK convenience, but they serve completely different authentication purposes and are not functionally linked in the token flow. The user's identity does not affect how the Runtime obtains its M2M token.

## PHASE 1: DEPLOYMENT WORKFLOW

This phase runs once during `cdk deploy`. Its goal is to register the OAuth2 Credential Provider in AgentCore Identity so the Runtime can use it at runtime.

### Step D1 -- Cognito M2M Infrastructure Setup

CDK provisions the Cognito resources needed for M2M authentication.

**Resources created:**
- `UserPoolResourceServer` -- defines API scopes (read, write) under identifier `<stack-name>-gateway`
- `UserPoolClient` (Machine Client) -- confidential app client with `clientCredentials: true` and `generateSecret: true`
- `secretsmanager.Secret` (Secret 1) -- stores the machine client's `client_id` and `client_secret`

**IAM Role Active:** None (CDK CloudFormation execution role handles provisioning)

**Data Flow:**
```
CDK CloudFormation
    --> Creates Cognito User Pool Resource Server
        --> Identifier: <stack-name>-gateway
        --> Scopes: read, write
    --> Creates Cognito Machine Client
        --> Grant type: CLIENT_CREDENTIALS
        --> generateSecret: true --> Cognito generates client_id + client_secret
    --> Stores client_secret in Secrets Manager as Secret 1
        --> Path: /<stack-name>/machine_client_secret
```

**Why:** The Machine Client is the OAuth2 identity used to request M2M tokens from Cognito. The Resource Server defines what scopes those tokens are valid for. Secret 1 is the secure, CDK-managed store for the credentials that will be used in the next step.

### Step D2 -- AgentCore Gateway Deployment with Cognito JWT Authorizer

CDK deploys the AgentCore Gateway (`CfnGateway`) configured with a `CUSTOM_JWT` authorizer pointing to the Cognito User Pool.

**Key configuration:**
```
authorizerType: "CUSTOM_JWT"
authorizerConfiguration:
  customJwtAuthorizer:
    discoveryUrl: https://cognito-idp.<region>.amazonaws.com/<userPoolId>/.well-known/openid-configuration
    allowedClients: [ machineClient.userPoolClientId ]
```

**IAM Role Active:** GatewayRole

**GatewayRole Permissions:**
- `lambda:InvokeFunction` on `toolLambda` -- Invoke MCP tool Lambda targets
- `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`
- `ssm:GetParameter`, `ssm:GetParameters`
- `cognito-idp:DescribeUserPoolClient` on User Pool ARN -- Introspect Cognito app client configuration for JWT validation
- `cognito-idp:InitiateAuth` on User Pool ARN -- Initiate Cognito auth flows for token-related operations
- `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`

**Data Flow:**
```
CDK CloudFormation
    --> Creates CfnGateway
        --> authorizerType: CUSTOM_JWT
        --> discoveryUrl: Cognito OIDC discovery URL (for JWKS fetching at runtime)
        --> allowedClients: [ machineClient.userPoolClientId ]
    --> Creates CfnGatewayTarget
        --> Protocol: MCP
        --> Target: toolLambda ARN
        --> Credential provider: GATEWAY_IAM_ROLE
    --> Stores Gateway URL in SSM: /<stack-name>/gateway_url
```

**Why:** The `discoveryUrl` specifies which Cognito User Pool to trust for token validation and is used at runtime to fetch the JWKS (public keys) for JWT signature verification. The `allowedClients` restriction ensures only tokens issued to the machine client are accepted.

### Step D3 -- OAuth2 Credential Provider Registration (Custom Resource)

The `oauth2ProviderLambda` (backed by a CDK Custom Resource) runs and registers the OAuth2 Credential Provider in AgentCore Identity's Token Vault.

**IAM Role Active:** oauth2ProviderLambda execution role (auto-created by CDK)

**oauth2ProviderLambda Role Permissions:**
- `secretsmanager:GetSecretValue` on Secret 1 (`/<stack-name>/machine_client_secret`) -- Read the Cognito machine client's `client_id` and `client_secret` from CDK-managed storage. These credentials are the source of truth and must be read before they can be registered with AgentCore Identity.
- `secretsmanager:CreateSecret` on Secret 2 (`bedrock-agentcore-identity!default/oauth2/*`) -- Create a new secret in the AgentCore Identity namespace in Secrets Manager. This namespace is where the Token Vault expects to find credentials at runtime.
- `secretsmanager:PutSecretValue` on Secret 2 -- Write the `client_id` and `client_secret` values into the newly created AgentCore Identity-managed secret, so the Token Vault can read them during M2M token retrieval.
- `secretsmanager:DescribeSecret` on Secret 2 -- Check whether Secret 2 already exists before attempting to create it. This enables idempotency -- if the stack is redeployed, the Lambda will not fail trying to create a secret that already exists.
- `secretsmanager:DeleteSecret` on Secret 2 -- Remove Secret 2 when the CDK stack is destroyed. Without this, the AgentCore Identity-managed secret would remain orphaned in Secrets Manager after stack deletion.
- `bedrock-agentcore:CreateOauth2CredentialProvider` on `token-vault/default` and `token-vault/default/oauth2credentialprovider/*` -- Register the OAuth2 Credential Provider in the Token Vault, linking the provider name (`<stack-name>-runtime-gateway-auth`) to the Cognito discovery URL, `client_id`, and Secret 2. This is the core registration step that makes the provider available to the Runtime at runtime.
- `bedrock-agentcore:GetOauth2CredentialProvider` on `token-vault/default` and `token-vault/default/oauth2credentialprovider/*` -- Verify that the provider was successfully created after registration. Also used on re-deploy to check whether the provider already exists before attempting to create it again (idempotency).
- `bedrock-agentcore:DeleteOauth2CredentialProvider` on `token-vault/default` and `token-vault/default/oauth2credentialprovider/*` -- Remove the provider registration from the Token Vault when the CDK stack is destroyed. Without this, the provider entry would remain orphaned in the Token Vault after stack deletion.
- `bedrock-agentcore:CreateTokenVault` on `token-vault/default` and `token-vault/default/*` -- Ensure the default Token Vault exists before attempting to register the provider. If the Token Vault has not been created yet, this permission allows the Lambda to create it as a prerequisite.
- `bedrock-agentcore:GetTokenVault` on `token-vault/default` and `token-vault/default/*` -- Check the status of the default Token Vault before operating on it. Used to confirm the vault is available and ready before registering the provider.
- `bedrock-agentcore:DeleteTokenVault` on `token-vault/default` and `token-vault/default/*` -- Clean up the Token Vault on stack destruction if needed. This is a defensive cleanup permission for full teardown scenarios.

**Data Flow:**
```
oauth2ProviderLambda
    |
    |-- 1. Reads Secret 1
    |       --> Gets: client_id, client_secret
    |
    |-- 2. Creates Secret 2 in Secrets Manager
    |       --> Namespace: bedrock-agentcore-identity!default/oauth2/<stack-name>-runtime-gateway-auth
    |       --> Stores: { client_id, client_secret }
    |
    |-- 3. Calls bedrock-agentcore:CreateOauth2CredentialProvider
    |       --> Provider name: <stack-name>-runtime-gateway-auth
    |       --> discoveryUrl: Cognito OIDC discovery URL
    |       --> clientId: machineClient.userPoolClientId
    |       --> secretArn: Secret 2 ARN
    |       --> grantType: CLIENT_CREDENTIALS (M2M / 2LO)
    |
    └-- 4. Provider is now registered in Token Vault (default)
            --> Provider ARN: arn:aws:bedrock-agentcore:<region>:<account>:token-vault/default/oauth2credentialprovider/<stack-name>-runtime-gateway-auth
```

**Why:** This registration step connects the logical provider name (`GATEWAY_CREDENTIAL_PROVIDER_NAME` env var) to the actual Cognito OAuth2 configuration, enabling the Runtime to obtain M2M tokens through AgentCore Identity.

### Step D4 -- AgentCore Runtime Deployment

CDK deploys the AgentCore Runtime with the AgentCoreRole and environment variables, including `GATEWAY_CREDENTIAL_PROVIDER_NAME`.

**IAM Role Active:** AgentCoreRole

**AgentCoreRole Permissions (M2M-relevant):**
- `bedrock-agentcore:GetOauth2CredentialProvider` on `oauth2-credential-provider/*` -- Look up the registered OAuth2 Credential Provider metadata by logical name (the value of `GATEWAY_CREDENTIAL_PROVIDER_NAME`). This is called inside the `@requires_access_token` decorator at runtime to resolve the provider name to its Cognito token URL, `client_id`, and Secret 2 reference. Without this permission, the decorator cannot initiate the token retrieval process.
- `bedrock-agentcore:GetResourceOauth2Token` on `token-vault/*` -- Request the M2M access token from the Token Vault. This is the primary permission for obtaining the Cognito JWT at runtime. The Token Vault either returns a cached valid token or fetches a new one from Cognito using the Client Credentials grant.
- `bedrock-agentcore:GetResourceOauth2Token` on `workload-identity-directory/*` -- Resolve the caller's IAM identity (AgentCoreRole) to a Workload Identity registered in the AgentCore Identity directory. The Token Vault uses this Workload Identity to scope the cached token to this specific agent, ensuring token isolation between agents even if they share the same IAM role.
- `secretsmanager:GetSecretValue` on Secret 2 (`bedrock-agentcore-identity!default/oauth2/<stack-name>-runtime-gateway-auth`) -- Required for IAM delegation: when the Token Vault needs to fetch a new token from Cognito (cache miss), AgentCore Identity reads Secret 2 using the Runtime's IAM role rather than its own service role. This means the Runtime must have `GetSecretValue` on Secret 2 -- not because the Runtime reads it directly, but because AgentCore Identity acts on behalf of the Runtime's role to access the credential. This design prevents privilege escalation: a caller cannot use AgentCore Identity as a proxy to access secrets it does not have direct permission to read.
- `secretsmanager:GetSecretValue` on Secret 1 (`/<stack-name>/machine_client_secret`) -- Defensive / testing use only. The standard Token Vault flow only requires Secret 2 access (via IAM delegation). Secret 1 access allows the Runtime or test scripts running inside it to call the Cognito token endpoint directly if needed outside the Token Vault flow. This permission is not required for the standard M2M path.
- `ssm:GetParameter`, `ssm:GetParameters` on `/<stack-name>/*` -- Read the Gateway URL (`/<stack-name>/gateway_url`) and other configuration values from SSM Parameter Store at runtime. The Gateway URL is fetched once when `create_gateway_mcp_client()` is called and used for all subsequent MCP connections.

**Data Flow:**
```
CDK CloudFormation
    --> Creates AgentCore Runtime
        --> Assigns AgentCoreRole as execution role
        --> Sets environment variables:
            GATEWAY_CREDENTIAL_PROVIDER_NAME = <stack-name>-runtime-gateway-auth
            STACK_NAME = <stack-name>
            MEMORY_ID = <memoryId>
        --> Configures inbound JWT authorizer (for human users calling the Runtime):
            discoveryUrl: Cognito User Pool discovery URL
            allowedAudiences: [ userPoolClientId ]  <-- human-facing app client, NOT machine client
        --> Configures requestHeaderConfiguration:
            allowlistedHeaders: [ "Authorization" ]  <-- so agent code can read the user's JWT
```

**Why the `GATEWAY_CREDENTIAL_PROVIDER_NAME` env var:** Decouples agent code from the specific provider ARN. Agent code only needs the logical name; AgentCore Identity resolves the provider configuration. This makes agent code portable across environments and stacks.

## PHASE 2: RUNTIME WORKFLOW

This phase runs every time the agent code needs to call the AgentCore Gateway. Its goal is to obtain a valid Cognito M2M token and use it to authenticate the Gateway request.

### Step R1 -- MCP Client Creation and Token Retrieval Setup

`create_gateway_mcp_client()` is called to set up the MCP client for Gateway communication. The Gateway URL is read from SSM once at this point (it is stable and does not change). The token retrieval is deferred into a lambda factory so it runs fresh on every MCP connection and reconnection.

**IAM Role Active:** AgentCoreRole

**Permission Used:** `ssm:GetParameter` on `/<stack-name>/*` (for Gateway URL lookup)

**Data Flow:**
```
create_gateway_mcp_client() is called
    |
    |-- 1. Reads STACK_NAME from env var
    |
    |-- 2. Reads Gateway URL from SSM:
    |       ssm:GetParameter --> /<stack-name>/gateway_url
    |       <-- Returns: Gateway URL (stable, fetched once)
    |
    └-- 3. Creates MCPClient with lambda factory:
            MCPClient(
                lambda: streamablehttp_client(
                    url=gateway_url,
                    headers={"Authorization": f"Bearer {_fetch_gateway_token()}"}
                ),
                prefix="gateway",
            )
            --> Token is NOT fetched here -- deferred into the lambda
            --> _fetch_gateway_token() will be called on every MCP connection/reconnection
```

**Why the lambda factory pattern:** This avoids the "closure trap". If `_fetch_gateway_token()` were called outside the lambda, Python's closure would capture the token value at client creation time. That token is valid for 60 minutes. If the MCP client reconnects after expiry, it would use the stale captured token and receive a 401 from the Gateway. By calling `_fetch_gateway_token()` inside the lambda, a fresh token is obtained on every MCP connection. The Token Vault's caching layer (inside the `@requires_access_token` decorator) ensures this is efficient -- if the token is still valid, the cached one is returned immediately without calling Cognito.

**Why the SSM read is outside the lambda:** The Gateway URL is a stable infrastructure endpoint that does not change between connections. It is safe and efficient to read it once at client creation time rather than on every reconnection.

### Step R2 -- Token Retrieval via @requires_access_token Decorator

On each MCP connection or reconnection, the lambda factory executes and calls `_fetch_gateway_token()`. The `@requires_access_token` decorator (part of the AgentCore Identity Python SDK) intercepts this call and handles all OAuth mechanics internally.

**IAM Role Active:** AgentCoreRole

**Data Flow:**
```
Lambda factory executes (on each MCP connection/reconnection)
    --> _fetch_gateway_token() is called
    --> @requires_access_token decorator intercepts:
        --> provider_name = GATEWAY_CREDENTIAL_PROVIDER_NAME env var
        --> auth_flow = "M2M"  (Client Credentials grant -- no user involved)
        --> scopes = []  (Cognito embeds scopes based on machine client authorization)
    --> Decorator calls AgentCore Identity API internally (see R3 for details)
    --> Decorator injects the obtained JWT as access_token argument
    --> _fetch_gateway_token(access_token=<jwt>) returns the JWT string
    --> MCPClient uses JWT in Authorization: Bearer header
```

**Why auth_flow="M2M" and scopes=[]:** `auth_flow="M2M"` tells the decorator to use the Client Credentials grant (no user interaction). `scopes=[]` is correct for M2M -- the scopes (`<stack-name>-gateway/read`, `<stack-name>-gateway/write`) are embedded in the token by Cognito based on what the machine client is authorized for, so they do not need to be specified at the call site.

**Note on decorator internals:** The `@requires_access_token` decorator is part of the AgentCore Identity Python SDK. Its internal token retrieval is a two-sub-step process described in R3 below. This is not visible in the agent code -- from the agent's perspective, the decorator is a single call that returns a token.

### Step R3 -- Inside the Decorator: Token Retrieval from Token Vault

Inside the `@requires_access_token` decorator, AgentCore Identity performs a two-sub-step process to obtain the token. AgentCore Identity checks the Token Vault for a cached, valid token. If none exists or the token is expired, it fetches a new one from Cognito.

**IAM Role Active:** AgentCoreRole

**Permissions Used:**
- `bedrock-agentcore:GetOauth2CredentialProvider` on `oauth2-credential-provider/*` -- Provider metadata lookup (Sub-step 3a)
- `bedrock-agentcore:GetResourceOauth2Token` on `token-vault/*` -- Token retrieval from Token Vault (Sub-step 3b)
- `bedrock-agentcore:GetResourceOauth2Token` on `workload-identity-directory/*` -- Workload Identity resolution for token scoping (Sub-step 3b)
- `secretsmanager:GetSecretValue` on Secret 2 -- IAM delegation for client_secret access (cache miss only, Sub-step 3b)

**Data Flow -- Sub-step 3a: Provider Metadata Lookup:**
```
@requires_access_token decorator (SDK internals)
    --> bedrock-agentcore:GetOauth2CredentialProvider
        --> Input: provider_name = <stack-name>-runtime-gateway-auth
        --> AgentCore Identity looks up the provider registered in Token Vault (Step D3)
    <-- Returns:
        --> Provider ARN
        --> Cognito token URL (derived from discoveryUrl registered in D3)
        --> client_id (machineClient.userPoolClientId)
        --> Reference to Secret 2 (where client_secret lives)
        --> Grant type: CLIENT_CREDENTIALS
```

**Data Flow -- Sub-step 3b: Token Vault Check and Token Issuance:**

**Cache Hit (token still valid):**
```
    --> bedrock-agentcore:GetResourceOauth2Token
        --> Resolves Workload Identity from AgentCoreRole ARN via workload-identity-directory
        --> Checks Token Vault: token for this Workload Identity + provider = VALID (< 60 min old)
    <-- Returns: cached JWT access token (no Cognito call needed)
```

**Cache Miss (no token or expired):**
```
    --> bedrock-agentcore:GetResourceOauth2Token
        --> Resolves Workload Identity from AgentCoreRole ARN via workload-identity-directory
        --> Checks Token Vault: no valid token found
        --> Reads Secret 2 using AgentCoreRole (IAM delegation)
            --> Gets: client_secret
        --> Calls Cognito token endpoint:
            POST https://<cognito-domain>.auth.<region>.amazoncognito.com/oauth2/token
            grant_type=client_credentials
            client_id=<machineClient.userPoolClientId>
            client_secret=<from Secret 2>
            scope=<stack-name>-gateway/read <stack-name>-gateway/write
        <-- Cognito returns: JWT access token (valid 60 minutes by default)
        --> Stores token in Token Vault, scoped to this Workload Identity
    <-- Returns: new JWT access token
```

**Why the Workload Identity matters:** The Token Vault stores tokens per Workload Identity, not per IAM role. This means even if two different agent runtimes shared the same IAM role, they would get separate token entries in the vault. The Workload Identity is the fine-grained, agent-level principal that ensures token isolation between agents.

**Why IAM delegation for Secret 2:** AgentCore Identity reads Secret 2 using the caller's IAM role (AgentCoreRole), not its own service role. This is a deliberate security design: the secret is only accessible if the caller has both the `GetResourceOauth2Token` API permission AND the `secretsmanager:GetSecretValue` permission on Secret 2. This prevents privilege escalation -- a caller cannot use AgentCore Identity as a proxy to access secrets it doesn't have direct permission to read.

**Why the Token Vault cache makes the lambda factory efficient:** Even though `_fetch_gateway_token()` is called on every MCP connection, the Token Vault cache means Cognito is only called when the token is expired (every ~60 minutes). All other calls return the cached token immediately, making the pattern both fresh and efficient.

### Step R4 -- Agent Code Sends Request to Gateway

The MCPClient uses the JWT returned by `_fetch_gateway_token()` to send an authenticated HTTP request to the AgentCore Gateway.

**IAM Role Active:** AgentCoreRole

**Data Flow:**
```
MCPClient lambda factory
    --> streamablehttp_client(
          url=gateway_url,  <-- read from SSM in Step R1, stable
          headers={"Authorization": f"Bearer {jwt}"}  <-- fresh token from Step R2/R3
      )
    --> Sends HTTP request:
        POST <gateway_url>/mcp
        Authorization: Bearer <cognito-jwt-token>
        Content-Type: application/json
        { ... MCP tool invocation payload ... }
```

**Why:** The Gateway URL is stable (read once in R1) while the token is fresh (fetched on each connection in R2/R3). The `Authorization: Bearer` header is the standard OAuth2 mechanism for presenting a token to a protected resource.

### Step R5 -- Gateway Validates the JWT Token

The AgentCore Gateway receives the request and its `CUSTOM_JWT` authorizer validates the Bearer token.

**IAM Role Active:** GatewayRole

**Data Flow:**
```
AgentCore Gateway (CUSTOM_JWT authorizer)
    |
    |-- 1. Extracts Bearer token from Authorization header
    |
    |-- 2. Fetches JWKS from Cognito discovery URL:
    |       GET https://cognito-idp.<region>.amazonaws.com/<userPoolId>/.well-known/openid-configuration
    |       --> Gets JWKS URI
    |       GET <jwks_uri>
    |       --> Gets Cognito public keys for signature verification
    |
    |-- 3. Verifies JWT signature using JWKS public keys
    |
    |-- 4. Checks token claims:
    |       --> client_id claim ∈ allowedClients (machineClient.userPoolClientId)
    |       --> token not expired
    |       --> issuer matches Cognito User Pool
    |
    └-- 5. Authorization decision:
            --> VALID --> forwards request to Gateway Target (Step R6)
            --> INVALID --> returns 401 Unauthorized
```

**Why allowedClients scoping:** The Gateway only accepts tokens issued to the specific machine client you created. Even if another Cognito client in the same User Pool obtained a token, it would be rejected. This is intentional tight scoping -- only the Runtime's machine client can call this Gateway.

### Step R6 -- Gateway Forwards to MCP Tool Lambda

The validated request is forwarded to the Gateway Target (the MCP tool Lambda).

**IAM Role Active:** GatewayRole

**Permission Used:** `lambda:InvokeFunction` on `toolLambda`

**Data Flow:**
```
AgentCore Gateway (GatewayRole)
    --> lambda:InvokeFunction on toolLambda
        --> MCP tool invocation payload
    <-- Lambda returns tool result
    <-- Gateway returns MCP response to Runtime
    <-- MCPClient delivers result to agent code
    <-- Agent code continues execution with tool result
```
