/**
 * Creates the CareHouse One product and its monthly plan in PayPal, and prints the plan ID to set
 * as PAYPAL_PLAN_ID. Each subscription sets its own start date (the 5th) and prorated first month
 * on top of the plan (see lib/billing-cycle.ts). Run once per PayPal environment:
 *
 *   PAYPAL_ENV=sandbox PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... npm run paypal:setup
 *
 * Use the sandbox first; run it again with PAYPAL_ENV=live and the live app's credentials at launch.
 */
import { PRICE_SUMMARY, TRIAL_DAYS } from "../src/lib/pricing";
import { createProductAndPlan } from "../src/server/paypal";

async function main() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  const env = process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";
  const { productId, planId } = await createProductAndPlan();
  console.log(`PayPal ${env}: product ${productId}`);
  console.log(`Plan (${TRIAL_DAYS}-day free trial, then ${PRICE_SUMMARY}): ${planId}`);
  console.log(`Set PAYPAL_PLAN_ID=${planId}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
