import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  BashTool,
  ReadTool,
  EditTool,
  WriteTool,
  GrepTool,
  GlobTool,
  TodoWriteTool,
  WebFetchTool,
  WebSearchTool,
  LsTool,
  TaskTool,
} from "./renderers";

/**
 * Map Claude Code tool names to their specialized renderers. Unknown tools
 * fall through to the generic ToolCallBlock via `tools.Fallback`.
 */
export const toolRenderersByName: Record<string, ToolCallMessagePartComponent> = {
  Bash: BashTool,
  Read: ReadTool,
  Edit: EditTool,
  Write: WriteTool,
  Grep: GrepTool,
  Glob: GlobTool,
  LS: LsTool,
  Task: TaskTool,
  TodoWrite: TodoWriteTool,
  WebFetch: WebFetchTool,
  WebSearch: WebSearchTool,
};

export { ToolGroup } from "./ToolGroup";
