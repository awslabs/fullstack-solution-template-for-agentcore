// Cedar policy for AgentCore Gateway tool access control.
//
// HOW IT WORKS:
// The Gateway's JWT Authorizer maps M2M JWT claims to Cedar principal tags:
//   JWT claim "department" → principal.getTag("department")
//   JWT claim "role"       → principal.getTag("role")
//   JWT claim "user_id"    → principal.getTag("user_id")
//
// These claims are injected into the M2M token by the Cognito V3 Pre-Token
// Lambda based on the authenticated user's identity.
//
// CEDAR SYNTAX NOTES:
// - Cedar is deny-by-default: if no permit statement matches a request, it is
//   automatically denied. An explicit forbid statement is not needed to block
//   access — simply omit the department from the permit's OR conditions.
// - The AgentCore create_policy API accepts ONE Cedar statement per policy.
//   To define multiple access rules, use the || (OR) operator within a single
//   permit statement rather than writing multiple permit statements.
// - The Cedar action name format is: "<TargetName>___<tool_name>" (triple underscore).
//   Tool name comes from tool_spec.json, target name from the CfnGatewayTarget.
//
// {{GATEWAY_ARN}} is replaced by CDK at deploy time with the actual Gateway ARN.
//
// TO CHANGE THE POLICY:
// Edit this file, then run `cdk deploy` to apply. The Custom Resource Lambda
// will detect the change and update the policy in-place without recreating
// the Policy Engine.
//
// ========================================
// VERSION 0: Permissive Wildcard (Action Name Discovery)
// ========================================
// Deploy this version first when setting up a new gateway target to discover
// the exact action name from CloudWatch logs, then switch to a scoped version.
//
// permit(
//   principal is AgentCore::OAuthUser,
//   action,
//   resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
// )
// when {
//   principal.hasTag("department")
// };
//
// ========================================
// VERSION 1: Guest Has Full Access (Testing "Allow" Case)
// ========================================
// All departments (finance, engineering, guest) can access the tool.
//
// permit(
//   principal is AgentCore::OAuthUser,
//   action == AgentCore::Action::"sample-tool-target___text_analysis_tool",
//   resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
// )
// when {
//   principal.hasTag("department") &&
//   (principal.getTag("department") == "finance" ||
//    principal.getTag("department") == "engineering" ||
//    principal.getTag("department") == "guest")
// };
//
// ========================================
// VERSION 2: Guest Denied (Testing "Deny" Case)
// ========================================
// Only finance and engineering can access the tool. Guests are denied
// automatically because Cedar is deny-by-default — no explicit forbid needed.

permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"sample-tool-target___text_analysis_tool",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("department") &&
  (principal.getTag("department") == "finance" ||
   principal.getTag("department") == "engineering")
};
