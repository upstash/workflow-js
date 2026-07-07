# Step-Level Flow Control Tests

These routes test step-level settings (`context.run(...).withSettings(...)`),
which override the flow control / retries the workflow run was triggered with,
for a single step only.

## How the tests work

Each route has an `increment` step with step-level flow control of
`parallelism: 1`, while the run itself is triggered with a permissive
trigger-level flow control (`parallelism: 5`). The test in `ci.test.ts`
triggers **3 concurrent runs** of the route.

The `increment` step increments a shared counter on Redis, holds it for a few
seconds and decrements it. The value observed right after incrementing is the
number of runs executing the step at that moment. If the step-level flow
control is applied, only one run at a time may execute the step, so the
observed value can never exceed 1 — even though the trigger-level flow
control would allow all runs to execute it concurrently. Each run asserts
this and saves `...-ok` or `...-violated` as its result.

## Routes

Step-level settings are applied to the request whose delivery executes the
step. Each route covers a different way that request is produced:

- **`step`**: the gated step comes after a `context.run` step. The settings
  are discovered by continuing the workflow function after the previous step
  executes (deferred submission), and ride on the previous step's result
  submission.
- **`call`**: the gated step comes after a `context.call` step. The settings
  can only be discovered when the call result arrives: the SDK fetches the
  run's steps, replays the workflow with the result (discovery mode) and
  attaches the discovered settings to the call result submission.
- **`invoke`**: the gated step comes after a `context.invoke` step. The
  invoke result delivery carries a marker header; seeing it, the SDK replays
  the workflow with the delivered steps (no extra fetch) before executing
  anything. Since the next step has settings, the SDK requests a hidden
  redelivery with the settings applied instead of executing the step in the
  ungated delivery. The redelivery then executes the step under the
  step-level flow control. (When the next step has no settings, the step is
  executed directly in the same delivery, without the extra request.)
