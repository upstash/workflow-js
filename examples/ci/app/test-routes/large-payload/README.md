This directory has a endpoints testing the lazy fetch functionality:
- `call-result`: endpoint called with context.call returns a large payload
- `error`: a large error is thrown. failureFunction is called with the initial body.
- `initial`: workflow is started with a large object
- `step-result`: a step returns a large result
- `step-result-parallel`: a parallel step returns a large result

In `utils.ts`, you can find the large object used.