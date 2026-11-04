import { Plugin } from "@opencode/plugin"

// Chronometer — the session's pulse, carried INSIDE tool results.
//
// Appends the wall clock to a completed tool result when at least a minute
// has passed since this session's last mark. The mark persists in history:
// unlike the old transient context push — which poisoned the newest cache
// segment (a cache entry ending in a transient line can never prefix-match
// the next request, so every round paid the previous round as uncached
// input) — a mark riding a result that is fresh anyway costs the cache
// nothing and stays readable in the transcript forever.
//
// Per session state: parallel sessions and subagents each keep their own
// cadence. The whole body is armoured: on any failure the hook stays silent
// and the result goes on without the clock line.
export default Plugin.define({
  id: "chronometer",
  async setup(ctx) {
    const raw = ctx.options.intervalMs
    const interval =
      typeof raw === "number" && raw >= 1000 ? raw : 60_000

    const lastBeat = new Map<string, number>()

    await ctx.tool.hook("execute.after", async (event: any) => {
      try {
        if (event.status !== "completed") return
        const sessionID: string | undefined =
          event.sessionID ?? event.context?.sessionID
        if (!sessionID) return

        const now = Date.now()
        const prev = lastBeat.get(sessionID)
        if (prev !== undefined && now - prev < interval) return
        lastBeat.set(sessionID, now)

        const clock = new Date().toLocaleString("sv-SE", { hour12: false })
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        const line = `[chronometer] ${clock} (${tz})`

        // Deliver through `content` — the only field the server persists:
        // it builds the result as to(content, output), where `output` is
        // read ONLY when `content` is empty, and it never is.
        const result = event.result
        if (!result || typeof result === "string") {
          event.result = {
            content: [{ type: "text", text: String(result ?? "") + "\n" + line }],
          }
        } else {
          const content = (result as any).content
          if (typeof content === "string") {
            event.result = { ...result, content: content + "\n" + line }
          } else if (Array.isArray(content)) {
            event.result = {
              ...result,
              content: [...content, { type: "text", text: line }],
            }
          } else {
            event.result = { ...result, content: [{ type: "text", text: line }] }
          }
        }
      } catch {
        // Never break a tool result over the clock.
      }
    })
  },
})
