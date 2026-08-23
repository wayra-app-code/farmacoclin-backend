const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { db } = require('./auth');

const PRICE_ID = process.env.STRIPE_PRICE_ID; // set after creating product in Stripe
const APP_URL = process.env.APP_URL || 'https://wayra-app-code.github.io/farmacoclin-mobile';

async function createCheckoutSession(user) {
  let customerId = user.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email });
    customerId = customer.id;
    db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, user.id);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: PRICE_ID, quantity: 1 }],
    success_url: `${APP_URL}?payment=success`,
    cancel_url: `${APP_URL}?payment=cancelled`,
  });

  return session.url;
}

async function handleWebhook(rawBody, signature) {
  const event = stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );

  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    if (sub.status === 'active') {
      db.prepare('UPDATE users SET plan = ?, stripe_subscription_id = ? WHERE stripe_customer_id = ?')
        .run('premium', sub.id, sub.customer);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    db.prepare('UPDATE users SET plan = ? WHERE stripe_customer_id = ?')
      .run('free', sub.customer);
  }

  return { received: true };
}

module.exports = { createCheckoutSession, handleWebhook, stripe };
