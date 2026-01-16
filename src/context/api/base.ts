import { CallResponse, CallSettings } from "../../types";
import { WorkflowContext } from "../context";
import { getProviderInfo } from "../provider";

export type ApiCallSettings<TBody = unknown, TFields extends object = object> = Omit<
  CallSettings,
  "url" | "body"
> & { body: TBody } & TFields;

export abstract class BaseWorkflowApi {
  protected context: WorkflowContext;

  /**
   * @param context workflow context
   */
  constructor({ context }: { context: WorkflowContext }) {
    this.context = context;
  }

  /**
   * context.call which uses a QStash API
   *
   * @param stepName name of the step
   * @param settings call settings including api configuration
   * @returns call response
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
    const { method: userMethod, body, headers = {}, retries = 0, retryDelay, timeout } = settings;

    return await this.context.call<TResult>(stepName, {
      url,
      method: userMethod ?? method,
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: {
        ...appendHeaders,
        ...headers,
      },
      retries,
      retryDelay,
      timeout,
    });
  }
}
