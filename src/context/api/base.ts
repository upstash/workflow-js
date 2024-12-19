import { CallResponse } from "../../types";
import { CallSettings, WorkflowContext } from "../context";
import { getProviderInfo } from "../provider";

export type ApiCallSettings<TBody = unknown, TFields extends object = object> = Omit<
  CallSettings<TBody>,
  "url"
> &
  TFields;

export abstract class BaseWorkflowApi {
  protected context: WorkflowContext;

  constructor({ context }: { context: WorkflowContext }) {
    this.context = context;
  }

  /**
   * context.call which uses a QStash API
   *
   * @param stepName
   * @param settings
   * @returns
   */
  protected async callApi<TResult = unknown, TBody = unknown>(
    stepName: string,
    settings: ApiCallSettings<
      TBody,
      {
        api: Parameters<typeof getProviderInfo>[0];
      }
    >
  ): Promise<CallResponse<TResult>> {
    const { url, appendHeaders, method } = getProviderInfo(settings.api);
    const { method: userMethod, body, headers = {}, retries = 0, timeout } = settings;

    return await this.context.call(stepName, {
      url,
      method: userMethod ?? method,
      body,
      headers: {
        ...appendHeaders,
        ...headers,
      },
      retries,
      timeout,
    });
  }
}
