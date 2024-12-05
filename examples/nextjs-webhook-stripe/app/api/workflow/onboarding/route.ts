import { serve } from "@upstash/workflow/nextjs";
import Stripe from "stripe"
import { Resend } from 'resend'

import { WebhookEvent } from "@clerk/nextjs/server";
import { Webhook } from 'svix';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
const resend = new Resend(process.env.RESEND_API_KEY ?? "")
export type OnboardingPayload = {
	event: string;
	clerkUserId: string;
	email: string;
	firstName: string;
	lastName: string;
}

async function validateRequest(payloadString: string, headerPayload: Headers) {

	const svixHeaders = {
		"svix-id": headerPayload.get("svix-id") as string,
		"svix-timestamp": headerPayload.get("svix-timestamp") as string,
		"svix-signature": headerPayload.get("svix-signature") as string,
	}
	const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET ?? "");
	return wh.verify(payloadString, svixHeaders) as WebhookEvent;
}

export const { POST } = serve<string>(async (context) => {
	const payloadString = context.requestPayload;
	const headerPayload = context.headers;

	let event: WebhookEvent;
	try {
		event = await validateRequest(payloadString, headerPayload);
	} catch {
		return
	}

	const user = await context.run<false | OnboardingPayload>("handle-clerk-webhook-event", async () => {
		if (event.type === "user.created") {
			const { id: clerkUserId, email_addresses, first_name, last_name } = event.data;
			const primaryEmail = email_addresses.find(email => email.id === event.data.primary_email_address_id)

			if (!primaryEmail) {
				return false
			}

			return {
				event: event.type,
				clerkUserId: clerkUserId,
				email: primaryEmail.email_address,
				firstName: first_name,
				lastName: last_name,
			} as OnboardingPayload
		}
		return false
	})

	if (!user) {
		return
	}

	const customer = await context.run("create-stripe-customer", async () => {
		return await stripe.customers.create({
			email: user.email,
			name: `${user.firstName} ${user.lastName}`,
			metadata: {
				clerkUserId: user.clerkUserId
			}
		})
	})

	await context.run("send-welcome-email", async () => {
		console.log("Sending welcome email to:", user.email)

		await resend.emails.send({
			from: 'welcome@yourdomain.com',
			to: user.email,
			subject: 'Welcome to Your Trial!',
			html: `
		        <h1>Welcome ${user.firstName || 'there'}!</h1>
		        <p>Thanks for signing up! Your trial starts now.</p>
		        <p>You have 7 days to explore all our premium features.</p>
		        <p>What you get with your trial:</p>
		        <ul>
		            <li>Feature 1</li>
		            <li>Feature 2</li>
		            <li>Feature 3</li>
		        </ul>
		        <p>Get started now: <a href="${process.env.NEXT_PUBLIC_URL}/dashboard">Visit Dashboard</a></p>
		    `
		});

	})

	const subscription = await context.run("create-trial", async () => {
		return await stripe.subscriptions.create({
			customer: customer.id,
			items: [{ price: "price_1QQQWaCKnqweyLP9MPbARyG" }],
			trial_period_days: 7,
			metadata: {
				clerkUserId: user.clerkUserId,
				workflowRunId: context.workflowRunId
			}
		})
	})

	await context.run("store-subscription", async () => {
		console.log(subscription)
	})


	const { timeout } = await context.waitForEvent("await-payment-method", `payment_method_${subscription.id}`, {
		timeout: "7d"
	})


	if (!timeout) {
		await context.run("send-subscription-start-welcome-mail", async () => {
			console.log("Sending subscription started email to:", user.email)

			await resend.emails.send({
				from: 'billing@yourdomain.com',
				to: user.email,
				subject: 'Payment Method Added Successfully!',
				html: `
			        <h1>Thank you for adding your payment method!</h1>
			        <p>Your subscription will continue automatically after the trial period.</p>
			        <p>Your trial benefits:</p>
			        <ul>
			            <li>Unlimited access to all features</li>
			            <li>Priority support</li>
			            <li>No interruption in service</li>
			        </ul>
			        <p>Need help? Reply to this email or visit our support center.</p>
			    `
			});
		})

	} else {
		await context.run("handle-trial-end", async () => {
			await stripe.subscriptions.update(subscription.id, {
				cancel_at_period_end: true
			})

			return { status: 'trial_ended' }
		})


		await context.run("send-trial-ending-mail", async () => {
			console.log("Sending trial ending email to:", user.email)

			await resend.emails.send({
				from: 'billing@yourdomain.com',
				to: user.email,
				subject: 'Your Trial is Ending Soon',
				html: `
			        <h1>Don't Lose Access!</h1>
			        <p>Your trial is coming to an end. Add a payment method to keep your access:</p>
			        <ul>
			            <li>Keep all your data and settings</li>
			            <li>Continue using premium features</li>
			            <li>No interruption in service</li>
			        </ul>
			        <a href="${process.env.NEXT_PUBLIC_URL}/billing" style="
			            display: inline-block;
			            padding: 12px 24px;
			            background-color: #0070f3;
			            color: white;
			            text-decoration: none;
			            border-radius: 5px;
			            margin: 20px 0;
			        ">Add Payment Method</a>
			        <p>Questions? Contact our support team!</p>
			    `
			});

		})
	}

}, { baseUrl: "<BASE_URL>", initialPayloadParser: (payload) => { return payload } })