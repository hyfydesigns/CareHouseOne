/**
 * Creates the CareHouse One product and its per-resident monthly plan (with the free trial) in
 * PayPal, and prints the plan ID to set as PAYPAL_PLAN_ID. Run once per PayPal environment:
 *
 *   PAYPAL_ENV=sandbox PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... npm run paypal:setup
 *
 * Use the sandbox first; run it again with PAYPAL_ENV=live and the live app's credentials at launch.
 */
import { createProductAndPlan, PRICE_PER_RESIDENT, TRIAL_DAYS } from "../src/server/paypal";

async function main() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  const env = process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";
  const { productId, planId } = await createProductAndPlan();
  console.log(`PayPal ${env}: product ${productId}`);
  console.log(`Plan ($${PRICE_PER_RESIDENT} per resident per month, ${TRIAL_DAYS}-day free trial): ${planId}`);
  console.log(`Set PAYPAL_PLAN_ID=${planId}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
