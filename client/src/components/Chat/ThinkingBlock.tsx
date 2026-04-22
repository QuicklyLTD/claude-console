import { Brain } from "lucide-react";
import type { ReasoningMessagePartProps } from "@assistant-ui/react";
import { Collapsible } from "@/components/ui/collapsible";

export function ThinkingBlock({ text }: ReasoningMessagePartProps) {
  return (
    <Collapsible
      className="my-2"
      ariaLabel={`Thinking block (${text.length} characters)`}
      title={
        <span className="inline-flex items-center gap-1 text-xs">
          <Brain className="h-3.5 w-3.5" />
          thinking · {text.length} chars
        </span>
      }
    >
      <pre className="text-[11px] font-mono whitespace-pre-wrap text-muted-foreground">{text}</pre>
    </Collapsible>
  );
}
