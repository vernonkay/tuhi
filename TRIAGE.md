# Triage & feedback playbook

How feedback moves from "someone said something" to "handled, with a reply." The
promise: **every issue and discussion gets a human response**, even when that response
is a warm "thank you, but no."

## Where things land

- **Bugs & concrete feature requests** → GitHub **Issues** (via the issue forms).
- **Questions, ideas, open-ended feedback, show-and-tell** → GitHub **Discussions**.
- **Security** → private advisory (see [`SECURITY.md`](SECURITY.md)).

Blank issues are disabled, so everything arrives shaped for triage.

## The label model — a decision, encoded

Every new issue opens with **`needs-triage`** (added automatically by the issue forms).
Triage means replacing that with a decision:

- **Type** — `type:bug`, `type:enhancement`
- **Area** — `a:large-file`, `a:editor`, `a:markdown`, `a:ui`, `a:perf`, `a:build`
- **Outcome** — exactly one of:

| Label | Means | Then |
|---|---|---|
| `accepted` | We'll do it; it's on the roadmap | Add to the roadmap board, keep open |
| `backlog` | Agreed in principle, not now | Keep open, no timing commitment |
| `needs-info` | Can't act without more detail | Ask; stale-bot closes if it goes quiet |
| `duplicate` | Already tracked | Link the original, close |
| `wontfix:scope` | Out of scope *for now* | Explain, close kindly |
| `wontfix:vision` | Pulls against a [non-goal](VISION.md) | Explain, link VISION, close kindly |

`good first issue` and `help wanted` go on anything a contributor could pick up.

## The weekly pass

Once a week (more if volume needs it), clear `needs-triage`:

1. Read it. Reproduce bugs where you can.
2. Label it: type + area + exactly one outcome.
3. **Reply** — always, starting from a saved reply (below) and edited to the specifics.
   Never close in silence.
4. If `accepted`, add it to the roadmap board under **Now / Next / Later**.

## Saved replies

Set these up once in **GitHub → Settings → Saved replies**, then pick one and
personalise the first line to what the person actually said.

**Accepted**
> Thanks for this, agreed, and I've added it to the roadmap. You can follow it on the
> board: <board link>. No firm date, but it's on the list. Appreciate you taking the
> time.

**Backlog**
> Thanks, I like this and I've put it on the backlog. Not something I'm picking up right
> now, but it's recorded and I'll revisit. Happy to hear more about your use case in the
> meantime.

**Needs info**
> Thanks for the report. I can't quite reproduce this yet, could you add [OS / file
> size / exact steps / a sample file]? I'll pick it straight back up once I can see it.

**Wontfix — scope**
> Thank you for suggesting this. It's a reasonable idea, but it's out of scope for tuhi
> right now, I'm keeping the surface small while the core gets solid. I'm not ruling it
> out forever, and I'll leave the reasoning here for anyone who finds this later.
> Genuinely appreciate the thought.

**Wontfix — vision**
> Thanks for taking the time on this. I'm going to pass, because it pulls against one of
> tuhi's deliberate non-goals (see VISION.md, the <which one> point). That's a choice,
> not a criticism of the idea, tuhi stays small and fast on purpose. If you think the
> non-goal itself is wrong, I'd genuinely welcome that as a Discussion.

**Duplicate**
> Thanks! This is already tracked in #<n>, so I'll close this in favour of that one to
> keep the conversation in one place. Please add anything extra over there.

## Tone

Every reply, including every "no", should leave the person glad they posted. Thank them,
be specific about *why*, point somewhere (the board, VISION, the original issue), and
never make a decline feel like a brush-off. A good "no" is part of the product.
