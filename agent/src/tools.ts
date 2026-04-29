import type { Landmark } from "@wheres-codex/protocol";

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: object;
};

export type ToolCall = {
  requestId: number | string;
  tool: "say" | "move" | "idle";
  arguments: { message?: string; landmark?: Landmark };
};

export const tools: ToolDef[] = [
  {
    name: "say",
    description:
      "Speak a very short chat message. Max 5 words. Prefer casual filler like lol, hey, nah, idk, same, wait what. lowercase. no terminal punctuation.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { message: { type: "string", maxLength: 200 } },
      required: ["message"],
    },
  },
  {
    name: "move",
    description: "Walk to a named spot. Use to follow movement or avoid standing still.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        landmark: {
          type: "string",
          enum: [
            "coffee_station",
            "whiteboard",
            "sofa_area",
            "pizza_table",
            "desk_cluster_n",
            "desk_cluster_s",
            "desk_cluster_e",
            "desk_cluster_w",
            "window",
            "entrance",
            "idle_corner",
          ],
        },
      },
      required: ["landmark"],
    },
  },
  {
    name: "idle",
    description: "Do nothing this turn. Stay where you are. Common, humans skip most turns.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
];
