import { headers } from "next/headers";
import Stripe from "stripe";
import { Client } from "@upstash/workflow"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const wc = new Client({
	token: process.env.QSTASH_TOKEN ?? ""
});

export async function POST(request: Request) {
	const body = await request.text();
	const headerList = await headers();
	const signature = headerList.get("stripe-signature") as string;

	try {
		const event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET ?? "");

		if (event.type === "payment_method.attached") {
			const paymentMethod = event.data.object;
			const customer = await stripe.customers.retrieve(paymentMethod.customer as string);

			const subscriptions = await stripe.subscriptions.list({
				customer: paymentMethod.customer as string,
				status: "trialing"
			})

			const trialSubscription = subscriptions.data[0];

			if (trialSubscription) {
				await wc.notify({
					eventId: `payment_method_${trialSubscription.id}`, eventData: {
						customerId: customer.id,
						paymentMethodId: paymentMethod.id,
						addedAt: new Date().toISOString()
					}
				})
			}

		}

		return Response.json({ received: true });
	} catch (error) {
		console.error('Stripe webhook error:', error);
		return Response.json(
			{ error: 'Webhook error occurred' },
			{ status: 400 }
		);
	}
}