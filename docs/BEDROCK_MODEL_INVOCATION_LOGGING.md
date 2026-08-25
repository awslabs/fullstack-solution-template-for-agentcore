# Bedrock Model Invocation Logging

This guide explains how to capture the raw model invocations that a FAST agent
makes to Amazon Bedrock, using the companion CloudFormation solution:

**Reference solution:** [enable-bedrock-logging-using-cloudformation](https://github.com/aws-samples/enable-bedrock-logging-using-cloudformation)

While the [AgentCore telemetry enablement](AGENTCORE_TELEMETRY.md) solution
captures what the agent *did* (logs and traces for Runtime, Gateway, Memory, and
Code Interpreter), this solution captures what the model *saw and returned* -
the prompts, completions, and metadata for each Bedrock model invocation.

## What it does

The template enables **Amazon Bedrock model invocation logging** at the account
level and provisions the resources needed to store those logs securely. It
delivers logs to both S3 and CloudWatch Logs, and enables delivery of large
payloads (over 100 KB) from CloudWatch to S3.

It can enable the following data delivery types based on the parameters you pass
at deploy time:

- Text data delivery
- Image data delivery
- Embedding data delivery
- Video data delivery

### Resources created

| Resource | Type |
|---|---|
| Bedrock invocation logs bucket | `AWS::S3::Bucket` |
| Invocation logs bucket policy | `AWS::S3::BucketPolicy` |
| Server access logs bucket | `AWS::S3::Bucket` |
| Server access logs bucket policy | `AWS::S3::BucketPolicy` |
| KMS key + alias | `AWS::KMS::Key`, `AWS::KMS::Alias` |
| CloudWatch Logs log group | `AWS::Logs::LogGroup` |
| Bedrock service role for logging (+ policy) | `AWS::IAM::Role`, `AWS::IAM::Policy` |
| Lambda execution role | `AWS::IAM::Role` |
| Lambda function (custom resource) | `AWS::Lambda::Function` |
| Custom resource invoker | `AWS::CloudFormation::CustomResource` |

A KMS key encrypts the log data in both S3 and CloudWatch Logs. A Lambda-backed
custom resource calls the Bedrock API to switch on model invocation logging,
since it is an account-level setting rather than a native CloudFormation
resource.

## Why it is separate from FAST

Model invocation logging is an **account and region level** Bedrock setting -
there is a single logging configuration per account per region. It is not scoped
to the FAST stack's resources, so it is deployed and owned independently. Deploy
this stack once per account/region where your FAST agents invoke Bedrock models.

> **Note:** Because there is one invocation logging configuration per
> account/region, avoid deploying multiple stacks that each try to enable it in
> the same region, as they will conflict.

## Prerequisites

- AWS CLI v2 configured for the target account and region.
- Permissions to create S3 buckets, a KMS key, CloudWatch log groups, IAM roles
  and policies, and a Lambda function (`CAPABILITY_IAM` /
  `CAPABILITY_NAMED_IAM`).

## Deploy

Clone or download the reference solution, then deploy the template. Choose which
data delivery types to enable through the template parameters (see the
solution's template for the exact parameter names):

```bash
aws cloudformation deploy \
  --template-file enable-bedrock-logging-using-cloudformation.yaml \
  --stack-name enable-bedrock-logging \
  --capabilities CAPABILITY_IAM \
  --region <your-region>
```

### Validate before deploying

```bash
cfn-lint enable-bedrock-logging-using-cloudformation.yaml
aws cloudformation validate-template --template-body file://enable-bedrock-logging-using-cloudformation.yaml
```

### Confirm logging is enabled

```bash
aws bedrock get-model-invocation-logging-configuration --region <your-region>
```

## Viewing invocation logs from FAST

After the stack is deployed and your FAST agent invokes a Bedrock model:

- **CloudWatch Logs**: open the log group created by the stack to inspect
  invocation records (prompts, completions, and metadata).
- **S3**: browse the invocation logs bucket for delivered records, including
  large payloads (over 100 KB) that overflow from CloudWatch.

## Security

This solution is a proof-of-value sample and is not intended as a
production-ready implementation. Review it against the AWS Shared Responsibility
Model and your organization's requirements before production use. Pay particular
attention to who can read the invocation logs bucket and KMS key, since model
invocation logs can contain sensitive prompt and completion data.

## References

- [Bedrock model invocation logging solution (GitHub)](https://github.com/aws-samples/enable-bedrock-logging-using-cloudformation)
- [Monitor model invocation using CloudWatch Logs and Amazon S3](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html)
- [Observability overview](OBSERVABILITY.md)
- [AgentCore Telemetry Enablement](AGENTCORE_TELEMETRY.md)
