# Upstash Workflow Nextjs Example with Webhooks Example

This example demonstrates how to use Upstash Workflow with Next.js to handle Clerk webhook events, manage Stripe subscriptions, and send automated emails. 

## Features

- Webhook handling for Clerk user events
- Stripe customer and subscription management
- Automated email sending with Resend
- Trial period management
- Event-driven workflow orchestration
- 
## Prerequisites

- Clerk account and API keys
- Stripe account and API keys
- Resend account and API key
- Upstash account and QStash credentials

## Development

1. Install the dependencies

```bash
npm install
```

2. Set up your environment variables in `.env.local`:

```shell .env.local
QSTASH_URL=
QSTASH_TOKEN=
CLERK_WEBHOOK_SECRET=
STRIPE_SECRET_KEY=
RESEND_API_KEY=
```

3. Open a local tunnel to your development server:

```bash
ngrok http 3000
```

Set the UPSTASH_WORKFLOW_URL environment variable to the ngrok URL.

4. Start the development server.

Then, run the `create-user.sh` script in the `sh` folder.

```bash
./sh/create-user.sh
```

## Workflow Steps

The example implements the following workflow:

1. Validate incoming Clerk webhook on `/api/workflow/onboarding` endpoint
2. Process user creation events
3. Create Stripe customer
4. Send welcome email
5. Set up trial subscription
6. Wait for `await-payment-method` event. If a payment method is added to user, `/api/workflow/stripe` endpoint will be triggered by Stripe workflow.
7. Handle trial period completion
8. Send appropriate follow-up emails

## Contributing
Contributions are welcome! Please read our contributing guidelines before submitting pull requests.