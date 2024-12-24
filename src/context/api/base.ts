import { CallResponse, CallSettings } from "../../types";
import { WorkflowContext } from "../context";
import { PublishRequest } from "@upstash/qstash";
import { WorkflowError } from "../../error";

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

    return await this.context.call<TResult, TBody>(stepName, {
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

/**
 * copies and updates the request by removing the api field and adding url & headers.
 *
 * @param api api field of PublishRequest
 * @returns updated request
 */
export const getProviderInfo = (api: Required<PublishRequest>["api"]) => {
  if (!api.provider) {
    throw new WorkflowError("A Provider must be provided.");
  }
  if (api.provider.owner === "upstash") {
    throw new WorkflowError("Upstash provider isn't supported.");
  }

  const { name, provider, ...parameters } = api;

  // validate provider
  if (!provider.baseUrl) throw new TypeError("baseUrl cannot be empty or undefined!");
  if (!provider.token) throw new TypeError("token cannot be empty or undefined!");
  if (provider.apiKind !== name) {
    throw new TypeError(`Unexpected api name. Expected '${provider.apiKind}', received ${name}`);
  }

  const providerInfo = {
    url: provider.getUrl(),
    baseUrl: provider.baseUrl,
    route: provider.getRoute(),
    appendHeaders: provider.getHeaders(parameters),
    owner: provider.owner,
    method: provider.method,
  };

  return provider.onFinish(providerInfo, parameters);
};
