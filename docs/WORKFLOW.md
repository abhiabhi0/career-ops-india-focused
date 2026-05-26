# Career-Ops Flexible Workflow

The pipeline operates on a powerful and flexible state machine centered around `data/pipeline.md`. This allows you to use local keyword matching, AI evaluation, or both in whatever combination you prefer.

## The State Machine

As jobs move through the pipeline, their checkbox in `data/pipeline.md` represents their current state:

- **`- [ ]` (Pending):** Raw URLs freshly discovered by `search-scan.js`.
- **`- [L]` (Local Pass):** Jobs that passed the fast, local keyword filter.
- **`- [x]` (AI Pass):** Jobs that were approved by the LLM AI agent.
- **`- [-]` (Rejected):** Jobs that failed either filter and should be ignored.
- **`- [D]` (Done):** Jobs that have been added to your HTML launcher and are ready for you to manually apply.

---

## 1. Local Keyword Filtering
*Best for rapidly filtering hundreds of jobs for free using the strict rules in your `profile.yml`.*

```bash
node apply-assist.mjs --filter-local
```
This command reads all **`- [ ]`** (Pending) jobs, uses an invisible browser to grab the page text, and checks your keywords.
- Jobs that match your rules are changed to **`- [L]`**.
- Jobs that fail are changed to **`- [-]`**.

---

## 2. AI Agent Evaluation
*Best for deep, nuanced reading of job descriptions.*

In your chat UI, run the slash command:
```bash
/career-ops
```
The AI agent will read your `pipeline.md`. By default, you can ask the agent to evaluate the **`- [ ]`** raw jobs. 
*Pro-tip: If you ran `--filter-local` first, you can ask the AI to evaluate only the **`- [L]`** jobs to save time and tokens!*
- Jobs the AI approves are changed to **`- [x]`**.
- Jobs the AI rejects are changed to **`- [-]`**.

---

## 3. Launching
*Once you have filtered jobs (via local, AI, or both), you need to put them in your launcher so you can open them in your browser.*

```bash
node apply-assist.mjs --launch
```
This command grabs all jobs with state **`- [L]`** or **`- [x]`**.
1. It safely appends them to today's `launcher-<date>.html`.
2. It changes their status to **`- [D]`** (Done) so they are never added twice.

---

## Example Workflows

### The "Speed" Flow (No AI)
1. `node search-scan.js --phase3` (Gets 500 URLs -> `[ ]`)
2. `node apply-assist.mjs --filter-local` (Keyword filters down to 50 URLs -> `[L]`)
3. `node apply-assist.mjs --launch` (Puts the 50 into launcher -> `[D]`)

### The "Nuance" Flow (AI Only)
1. `node search-scan.js --phase1` (Gets 20 high quality URLs -> `[ ]`)
2. `/career-ops` (AI evaluates down to 5 perfect URLs -> `[x]`)
3. `node apply-assist.mjs --launch` (Puts the 5 into launcher -> `[D]`)

### The "Hybrid" Flow (Ultimate Efficiency)
1. `node search-scan.js --phase3` (Gets 500 URLs -> `[ ]`)
2. `node apply-assist.mjs --filter-local` (Pre-filter down to 50 URLs -> `[L]`)
3. `/career-ops` (Ask AI to review the 50 `[L]` jobs, it approves 10 -> `[x]`)
4. `node apply-assist.mjs --launch` (Puts the 10 into launcher -> `[D]`)
