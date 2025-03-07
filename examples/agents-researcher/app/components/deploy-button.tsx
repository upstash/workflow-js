export default function DeployButton() {
    return (
      <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fupstash%2Fworkflow-js%2Ftree%2Fmain%2Fexamples%2Fagents-researcher&env=OPENAI_API_KEY,WOLFRAM_ALPHA_APP_ID,EXASEARCH_API_KEY&project-name=agents-researcher&repository-name=agents-researcher&demo-title=Cross%20Reference%20Agent&demo-description=A%20simple%20example%20to%20demonstrate%20how%20to%20use%20Upstash%20Workflow%20Agents%20to%20cross-reference%20information%20from%20different%20sources.&demo-url=https%3A%2F%2Fagents-researcher.vercel.app%2F&products=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22protocol%22%3A%22storage%22%2C%22group%22%3A%22%22%7D%2C%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-qstash%22%2C%22protocol%22%3A%22storage%22%2C%22group%22%3A%22%22%7D%5D">
        <img src="https://vercel.com/button" alt="Deploy with Vercel" />
      </a>
    );
  }
  