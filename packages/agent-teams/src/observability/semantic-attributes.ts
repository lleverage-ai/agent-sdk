/**
 * Semantic attributes for team tracing spans.
 *
 * These follow OpenTelemetry naming conventions and provide consistent
 * attribute keys for team-related spans.
 *
 * @packageDocumentation
 */

export const TeamSemanticAttributes = {
  TEAM_NAME: "team.name",
  TEAM_SESSION_ID: "team.session_id",
  TEAM_AGENT_ID: "team.agent_id",
  TEAM_AGENT_ROLE: "team.agent_role",
  TEAM_TASK_ID: "team.task_id",
  TEAM_TASK_TITLE: "team.task_title",
  TEAM_TASK_STATUS: "team.task_status",
  TEAM_TASK_COUNT: "team.task_count",
  TEAM_MESSAGE_TYPE: "team.message_type",
  TEAM_MESSAGE_FROM: "team.message_from",
  TEAM_MESSAGE_TO: "team.message_to",
  TEAM_PLAN_ID: "team.plan_id",
} as const;
