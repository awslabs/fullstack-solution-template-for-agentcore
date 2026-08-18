// Cedar policy for AgentCore Gateway tool access control.
//
// HOW IT WORKS:
// The Gateway's JWT Authorizer maps M2M JWT claims to Cedar principal tags:
//   JWT claim "department" → principal.getTag("department")
//   JWT claim "role"       → principal.getTag("role")
//   JWT claim "user_id"    → principal.getTag("user_id")
//
// CLAIM TYPES:
// The claims referenced in the "when" block below are CUSTOM claims. 
// They are injected by the Cognito V3 Pre-Token
// Lambda via claimsToAddOrOverride. You can define the claim names you need
// — ensure the Pre-Token Lambda output matches the Cedar policy.
//
// Standard claims (sub, iss, client_id, scope, exp, etc.) are also available
// as principal tags but are managed automatically by Cognito.
//
// CEDAR SYNTAX NOTES:
// - Cedar is deny-by-default: if no permit statement matches a request, it is
//   automatically denied. An explicit forbid statement is not needed to block
//   access — simply omit the department from the permit's OR conditions.
// - Each create_policy call creates one policy containing one Cedar statement.
//   You can call create_policy multiple times to add multiple policies to the
//   same engine. Alternatively, use || or action in [...] to combine rules
//   within a single statement.
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
// VERSION 1: Guest Has Full Access (Testing "Allow" Case)
// ========================================
// All departments (finance, engineering, guest) can access every gateway tool.
// No action constraint: this covers the sample tool AND tools from any MCP
// servers configured via backend.mcp_servers (their tool names are only known
// at runtime, so they cannot be enumerated here). Per-user MCP server
// enable/disable is enforced by the agent runtime (tools/mcp_prefs.py), not
// by this policy. To restrict specific tools by department, add an action
// constraint as shown in VERSION 2.

permit(
  principal is AgentCore::OAuthUser,
  action,
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("department") &&
  (principal.getTag("department") == "finance" ||
   principal.getTag("department") == "engineering" ||
   principal.getTag("department") == "guest")
};
//
// ========================================
// VERSION 2: Guest Denied (Testing "Deny" Case)
// ========================================
// Only finance and engineering can access the tool. Guests are denied
// automatically because Cedar is deny-by-default — no explicit forbid needed.
//
// permit(
//   principal is AgentCore::OAuthUser,
//   action == AgentCore::Action::"sample-tool-target___text_analysis_tool",
//   resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
// )
// when {
//   principal.hasTag("department") &&
//   (principal.getTag("department") == "finance" ||
//    principal.getTag("department") == "engineering")
// };
