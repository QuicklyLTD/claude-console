import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useUiStore, type Theme } from "@/store/ui";
import { useSessionStore } from "@/store/session";
import { api } from "@/lib/api";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";

export function SettingsModal() {
  const show = useUiStore((s) => s.showSettings);
  const setShow = useUiStore((s) => s.setShowSettings);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const quietMode = useUiStore((s) => s.quietMode);
  const toggleQuiet = useUiStore((s) => s.toggleQuiet);

  const activeId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const upsert = useSessionStore((s) => s.upsertSession);
  const active = sessions.find((s) => s.id === activeId) ?? null;

  const [cwd, setCwd] = useState("");
  const [addDirs, setAddDirs] = useState("");
  const [maxTurns, setMaxTurns] = useState<string>("");
  const [sysPrompt, setSysPrompt] = useState("");
  const [tags, setTags] = useState("");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("default");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!show || !active) return;
    setCwd(active.workingDir ?? "");
    setAddDirs(active.additionalDirectories.join("; "));
    setMaxTurns(active.maxTurns != null ? String(active.maxTurns) : "");
    setSysPrompt(active.systemPromptAppend ?? "");
    setTags(active.tags.join(", "));
    setPermissionMode(active.permissionMode);
  }, [show, active]);

  async function save() {
    if (!active) return;
    setSaving(true);
    try {
      const { session } = await api.patchSession(active.id, {
        workingDir: cwd.trim() || null,
        additionalDirectories: addDirs.split(";").map((s) => s.trim()).filter(Boolean),
        maxTurns: maxTurns.trim() ? Number(maxTurns) : null,
        systemPromptAppend: sysPrompt.trim() || null,
        tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
        permissionMode,
      });
      upsert(session);
      setShow(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={show} onOpenChange={setShow}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Session-specific configuration & appearance.</DialogDescription>
        </DialogHeader>

        <section className="grid gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Theme</div>
            <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
              <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="light">Light</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="quiet"
              type="checkbox"
              checked={quietMode}
              onChange={() => toggleQuiet()}
              className="size-4"
            />
            <label htmlFor="quiet" className="text-sm">
              Quiet mode — hide status / rate-limit / repeated init messages
            </label>
          </div>

          <Separator />

          {active ? (
            <>
              <h3 className="text-sm font-semibold">Session: {active.title}</h3>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Working directory</div>
                <Input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="absolute path" />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Additional directories (`;` separated)
                </div>
                <Input value={addDirs} onChange={(e) => setAddDirs(e.target.value)} placeholder="/extra/path; /another" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Permission mode</div>
                  <Select value={permissionMode} onValueChange={(v) => setPermissionMode(v as PermissionMode)}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">default</SelectItem>
                      <SelectItem value="acceptEdits">acceptEdits</SelectItem>
                      <SelectItem value="plan">plan</SelectItem>
                      <SelectItem value="bypassPermissions">bypassPermissions</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Max turns</div>
                  <Input
                    value={maxTurns}
                    onChange={(e) => setMaxTurns(e.target.value)}
                    placeholder="unlimited"
                    type="number"
                  />
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Tags (comma separated)
                </div>
                <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="backend, refactor" />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Append to system prompt
                </div>
                <Textarea
                  value={sysPrompt}
                  onChange={(e) => setSysPrompt(e.target.value)}
                  placeholder="Extra instructions appended to the Claude Code default system prompt"
                  rows={5}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShow(false)}>Cancel</Button>
                <Button onClick={save} disabled={saving}>Save</Button>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Changes that require a new agent run (cwd, additionalDirectories, systemPromptAppend, maxTurns)
                take effect the next time you attach this session. Live-switchable: model, permission mode.
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">No active session.</div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
