Under the `wait-for-event` directory, there are three routes:
- `/workflow`: the workflow we run in the tests to do the following in order:
  1. wait for a random event which should timeout
  2. sequentially, call `/notifier` and wait to get notified. `/notifier` uses `waitUntil` to sleep for 2 secs and call notify
  3. in parallel, call `/notifier-workflow` and wait to get notified with text data
  4. wait to get notified with object data by `/notifier-workflow`
- `/notifier`: an endpoint which notifies the workflow using the SDK
- `/notifier-workflow`: a workflow which notifies the original workflow two times:
  1. with a text event data
  2. with an object event data

`/notifier` workflow will keep retrying until it has successfully notified the original worklfow two times (one with text one with object).

once the `/notifier-workflow` finishes execution, it will save it's state to Redis. `/workflow` will check if `/notifier-workflow` has finished in its last step.