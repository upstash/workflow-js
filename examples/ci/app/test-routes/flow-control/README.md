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

Step-level settings must be on the request whose delivery executes the step.
The SDK only learns about a step when the workflow function is replayed, which
happens in a delivery published before the step was known. So when the executor
reaches a step with settings in an ungated delivery, it publishes a hidden
`discovery` request carrying the settings instead of executing the step; QStash
delivers that request gated by the step-level flow control and the step runs
there. The three routes cover the ways the ungated delivery is produced:

- **`step`**: the gated step comes after a `context.run` step, so the ungated
  delivery is the one carrying the previous step's result.
- **`call`**: the gated step comes after a `context.call` step, so the ungated
  delivery is the one carrying the call result the SDK republished.
- **`invoke`**: the gated step comes after a `context.invoke` step, so the
  ungated delivery is the one QStash publishes with the invoked run's result.

The mechanism is the same in all three; the routes exist to prove it doesn't
depend on how the previous step's result reached the endpoint. Steps running in
parallel are the one case which needs no extra request: each carries its
settings on its own plan step, whose delivery executes it.
