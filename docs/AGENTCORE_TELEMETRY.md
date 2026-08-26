# AgentCore Telemetry Enablement

This guide explains how to turn on CloudWatch Observability telemetry (logs and
traces) for the Amazon Bedrock AgentCore resources that FAST deploys, using the
companion CloudFormation solution:

**Reference solution:** [sample-telemetry-enablement-for-agentcore-cloudformation](https://github.com/aws-samples/sample-telemetry-enablement-for-agentcore-cloudformation)

FAST deploys AgentCore Runtime, Gateway, Memory, and Code Interpreter. This
solution creates telemetry enablement rules that apply to **all current and
future** AgentCore resources of each enabled type in the region, so it covers
the FAST resources whether you deploy it before or after your FAST stack.

## What it does

The template creates telemetry rules that deliver:

- **Logs** to CloudWatch Logs under the pattern
  `/aws/bedrock-agentcore/<resourceId>/<logType>`.
- **Traces** to X-Ray, ingested into the CloudWatch Logs group `aws/spans`.

Two delivery paths are used, depending on CloudFormation schema support:

| AgentCore resource | Delivery path | Telemetry captured | Used by FAST |
|---|---|---|---|
| Runtime | `AWS::ObservabilityAdmin::TelemetryRule` | Application logs, usage logs, traces | Yes |
| Gateway | `Custom::TelemetryRule` (inline Lambda) | Application logs, traces | Yes |
| Memory | `Custom::TelemetryRule` (inline Lambda) | Application logs, traces | Yes |
| CodeInterpreter | `AWS::ObservabilityAdmin::TelemetryRule` | Usage logs, traces | Yes |
| Browser | `AWS::ObservabilityAdmin::TelemetryRule` | Usage logs, traces | Optional |
| WorkloadIdentity | `Custom::TelemetryRule` (inline Lambda) | Application logs, traces | Optional |

Gateway, Memory, and WorkloadIdentity are not yet in the CloudFormation schema,
so the template provisions them through an inline Python Lambda custom resource
that calls the `observabilityadmin` API.

### Resources created

- Native and custom telemetry rule resources for each enabled resource type,
  scoped to the stack's region.
- An `AWS::XRay::ResourcePolicy` that authorizes the log delivery service to
  write AgentCore traces to X-Ray in the region.
- An inline Python Lambda (custom resource handler) and its IAM execution role.

## Prerequisites

These are **account and region level** settings that the template does not
create. Enable them once per region where you deploy FAST:

- **CloudWatch Transaction Search** - required for AgentCore trace delivery to
  X-Ray. Without it, trace deliveries fail.
  See [Enable Transaction Search](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Enable-TransactionSearch.html).
- **CloudWatch telemetry resource discovery** - lets CloudWatch discover your
  resources and their telemetry configuration metadata.
  See [Setting up telemetry configuration](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/telemetry-config-turn-on.html).

You also need AWS CLI v2 configured for the target account and region, and
permissions to create an IAM role (`CAPABILITY_IAM`), a Lambda function,
ObservabilityAdmin telemetry rules, and an X-Ray resource policy
(`xray:PutResourcePolicy`).

## Parameters

Each `Enable*Telemetry` parameter controls whether the rules for one resource
type are created. All default to `"true"`.

| Parameter | Default | Effect |
|---|---|---|
| `EnableRuntimeTelemetry` | `true` | Rules for Runtime resources |
| `EnableBrowserTelemetry` | `true` | Rules for Browser resources |
| `EnableCodeInterpreterTelemetry` | `true` | Rules for CodeInterpreter resources |
| `EnableGatewayTelemetry` | `true` | Rules for Gateway resources |
| `EnableMemoryTelemetry` | `true` | Rules for Memory resources |
| `EnableWorkloadIdentityTelemetry` | `true` | Rules for WorkloadIdentity resources |

There is no region parameter; the stack acts on the region it is deployed to
(`AWS::Region`). Deploy it in the **same region as your FAST stack**.

## Deploy

Clone or download the reference solution, then deploy the template. A plain
deploy enables telemetry for every resource type in the region:

```bash
aws cloudformation deploy \
  --template-file bedrock-agentcore-telemetry-template.yaml \
  --stack-name bedrock-agentcore-telemetry-enablement \
  --capabilities CAPABILITY_IAM \
  --region <your-region>
```

To match FAST exactly you can leave the defaults on. If your FAST deployment
does not use Browser or Workload Identity, you may disable those:

```bash
aws cloudformation deploy \
  --template-file bedrock-agentcore-telemetry-template.yaml \
  --stack-name bedrock-agentcore-telemetry-enablement \
  --capabilities CAPABILITY_IAM \
  --region <your-region> \
  --parameter-overrides EnableBrowserTelemetry=false EnableWorkloadIdentityTelemetry=false
```

### Validate before deploying

```bash
cfn-lint bedrock-agentcore-telemetry-template.yaml
aws cloudformation validate-template --template-body file://bedrock-agentcore-telemetry-template.yaml
```

### Confirm the rules were created

```bash
aws observabilityadmin list-telemetry-rules --region <your-region>
```

## Viewing telemetry from FAST

After the stack is deployed and your FAST agent handles a request:

- **Logs**: open CloudWatch Logs and look for log groups under
  `/aws/bedrock-agentcore/<resourceId>/...` for your Runtime, Gateway, and
  Memory resources.
- **Traces**: open the CloudWatch Application Signals / X-Ray trace views, or
  query the `aws/spans` log group, to see end-to-end traces of agent
  invocations.

## Security

This solution is a proof-of-value sample and is not intended as a
production-ready implementation. Review it against the AWS Shared Responsibility
Model and your organization's requirements before production use.

## References

- [AgentCore telemetry enablement solution (GitHub)](https://github.com/aws-samples/sample-telemetry-enablement-for-agentcore-cloudformation)
- [Enable CloudWatch Transaction Search](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Enable-TransactionSearch.html)
- [What is telemetry discovery and enablement?](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/telemetry-config-what-is.html)
- [Observability overview](OBSERVABILITY.md)
- [Bedrock Model Invocation Logging](BEDROCK_MODEL_INVOCATION_LOGGING.md)
