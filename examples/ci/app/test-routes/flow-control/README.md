# Step-Level Flow Control Tests

These routes test step-level settings (the third argument of `context.run`),
which override the flow control / retries the workflow run was triggered with,
for a single step only.

## How the tests work

Most routes are triggered once, as a **coordinator** workflow which invokes
`WORKER_COUNT` **workers** in parallel. The workers are the concurrency that
the step-level flow control has to hold back: each reaches an `increment` step
carrying step-level flow control of `parallelism: 1`, while the run itself is
triggered with a permissive trigger-level flow control (`parallelism: 5`).

`increment` increments a counter shared by the workers, holds it for a few
seconds and decrements it. The value a worker observes right after incrementing
is how many workers were inside the step at that moment. If the step-level flow
control is applied, no worker can ever observe more than 1 — even though the
trigger-level flow control would let all of them run it at once. The
coordinator collects the observed values and saves `...-ok` or `...-violated`
as the run's result.

The shared pieces live in `shared.ts`; a route only defines what its worker
does before the step which carries the settings.

## Routes

Step-level settings must be on the request whose delivery executes the step.
The SDK only learns about a step when the workflow function is replayed, which
happens in a delivery published before the step was known. So when the executor
reaches a step with settings in an ordinary delivery it publishes a hidden step
config request carrying them, and the step runs in the delivery QStash
produces. The exception is a step which follows one whose result the SDK
computed itself — there the settings ride on that step's submission, and no
extra request is needed.

- **`first-step`**: the step with settings is the first step of the worker, so there is
  no earlier step to carry its settings.
- **`step`**: the step with settings comes after a `context.run` step, so its settings
  ride on that step's submission — the one case which costs no extra request.
- **`call`**: the step with settings comes after a `context.call` step, so the
  ordinary delivery is the one carrying the call result.
- **`invoke`**: the step with settings comes after a `context.invoke` step, so the
  ordinary delivery is the one QStash publishes with the invoked run's result.
- **`parallel`**: the steps with settings are in a parallel group, which is the
  other case needing no extra request — each carries its settings on its own
  plan step, whose delivery executes it. One workflow rather than a coordinator
  and workers: the six steps of the group are the concurrency. They form two
  groups of three, each sharing a flow control key of `parallelism: 1` and a
  counter of its own, so the two keys have to hold their groups back
  independently.
- **`invoke-failure`**: not a concurrency test. The worker throws right after a
  step with settings, while the SDK is still holding that step's result. The
  coordinator asserts that the invoke reports the failure, and reads the
  worker's log to see that the held result reached QStash before the error did.
- **`normalization`**: not a concurrency test. A single run walks a range of
  settings shapes and asserts that each comes back from QStash in a form the
  SDK recognizes, and that the run costs exactly the expected number of
  requests — the count being what would catch a step republished in a loop.
