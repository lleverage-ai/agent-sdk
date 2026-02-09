/**
 * Team message tool for sending and receiving inter-agent messages.
 *
 * Available to any agent in a team. Provides send, receive, and poll operations.
 *
 * @packageDocumentation
 */

import { tool } from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { HookRegistration, Tracer } from "@lleverage-ai/agent-sdk";
import type { Mailbox } from "../mailbox/types.js";
import type { TeamMessage } from "../types.js";
import { fireTeamHook } from "../hooks/invoke.js";
import { TeamSemanticAttributes } from "../observability/semantic-attributes.js";

export interface TeamMessageToolOptions {
  /** This agent's ID */
  agentId: string;
  /** Mailbox instance */
  mailbox: Mailbox;
  /** Optional hook registrations for firing team events */
  hooks?: HookRegistration;
  /** Optional tracer for creating spans */
  tracer?: Tracer;
  /** Optional session ID for hook context */
  sessionId?: string;
}

/** Create team messaging tools for an agent. */
export function createTeamMessageTool(options: TeamMessageToolOptions) {
  const { agentId, mailbox, hooks, tracer, sessionId } = options;

  return {
    team_send_message: tool({
      description:
        "Send a message to another agent in the team. Use this to coordinate, share results, or request help.",
      inputSchema: z.object({
        to: z.string().describe("Agent ID of the recipient"),
        content: z.string().describe("Message content"),
        type: z
          .enum(["text", "task_update", "custom"])
          .optional()
          .describe("Message type. Default: text"),
      }),
      execute: async (params: { to: string; content: string; type?: "text" | "task_update" | "custom" }) => {
        const fn = async () => {
          const message: TeamMessage = {
            id: randomUUID(),
            from: agentId,
            to: params.to,
            type: params.type ?? "text",
            payload: { content: params.content },
            timestamp: new Date().toISOString(),
          };
          await mailbox.send(message);
          await fireTeamHook(hooks, "TeamMessageReceived", {
            messageId: message.id,
            from: agentId,
            to: params.to,
            messageType: message.type,
          }, sessionId);
          return `Message sent to ${params.to}`;
        };

        if (tracer?.enabled) {
          return tracer.withSpan("team.message", async (span) => {
            span.setAttribute(TeamSemanticAttributes.TEAM_MESSAGE_FROM, agentId);
            span.setAttribute(TeamSemanticAttributes.TEAM_MESSAGE_TO, params.to);
            span.setAttribute(TeamSemanticAttributes.TEAM_MESSAGE_TYPE, params.type ?? "text");
            return fn();
          });
        }
        return fn();
      },
    }),

    team_broadcast_message: tool({
      description: "Broadcast a message to all agents in the team.",
      inputSchema: z.object({
        content: z.string().describe("Message content"),
      }),
      execute: async (params: { content: string }) => {
        const fn = async () => {
          const message: TeamMessage = {
            id: randomUUID(),
            from: agentId,
            to: "__broadcast__",
            type: "text",
            payload: { content: params.content },
            timestamp: new Date().toISOString(),
          };
          await mailbox.broadcast(message);
          await fireTeamHook(hooks, "TeamMessageReceived", {
            messageId: message.id,
            from: agentId,
            to: "__broadcast__",
            messageType: "text",
          }, sessionId);
          return "Broadcast message sent";
        };

        if (tracer?.enabled) {
          return tracer.withSpan("team.message", async (span) => {
            span.setAttribute(TeamSemanticAttributes.TEAM_MESSAGE_FROM, agentId);
            span.setAttribute(TeamSemanticAttributes.TEAM_MESSAGE_TO, "__broadcast__");
            span.setAttribute(TeamSemanticAttributes.TEAM_MESSAGE_TYPE, "text");
            return fn();
          });
        }
        return fn();
      },
    }),

    team_read_messages: tool({
      description:
        "Read new messages from your inbox and broadcast channel. Returns messages received since last read.",
      inputSchema: z.object({}),
      execute: async () => {
        const messages = await mailbox.readAll(agentId);
        if (messages.length === 0) {
          return "No new messages";
        }
        return messages
          .map(
            (m) =>
              `[${m.timestamp}] From ${m.from} (${m.type}): ${JSON.stringify(m.payload)}`,
          )
          .join("\n");
      },
    }),
  };
}
