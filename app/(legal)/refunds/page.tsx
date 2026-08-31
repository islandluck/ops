import { LegalDoc } from "../doc";

export const metadata = {
  title: "Refund Policy — Operator",
  description: "How subscriptions, cancellations, and refunds work for Operator.",
};

/* TEMPLATE — a solid starting draft. Have counsel review before you rely on it. */
export default function RefundsPage() {
  return (
    <LegalDoc title="Refund Policy" updated="August 30, 2026">
      <p>
        This policy explains how billing, cancellations, and refunds work for paid Operator subscriptions. It
        supplements our <a href="/terms">Terms of Service</a>.
      </p>

      <h2>Subscriptions</h2>
      <p>
        Paid plans are billed in advance each period (monthly unless stated otherwise) and renew automatically until
        cancelled. You can view your plan and payment history at any time in the billing portal.
      </p>

      <h2>Free trial</h2>
      <p>
        Where a free trial is offered, you will not be charged until the trial ends. If you cancel before the trial
        ends, you will not be billed. If you do not cancel, your plan begins at the end of the trial at the price shown
        when you signed up.
      </p>

      <h2>Cancellation</h2>
      <p>
        You can cancel anytime from the billing portal. Cancellation stops future renewals; you keep access to paid
        features until the end of the current billing period. We do not automatically prorate or refund the unused
        portion of a period unless required by law.
      </p>

      <h2>Refunds</h2>
      <p>
        Payments are generally non-refundable. That said, we want you to be satisfied — if something went wrong or you
        were charged in error, contact us within <strong>14 days</strong> of the charge and we will review your request
        in good faith and, where appropriate, issue a full or partial refund. Refunds are returned to your original
        payment method.
      </p>

      <h2>Failed payments</h2>
      <p>
        If a renewal payment fails, we may retry it and will notify you. If payment remains unresolved, paid features
        may be suspended until billing is brought current.
      </p>

      <h2>Price changes</h2>
      <p>
        We may change subscription prices. Any change applies to future billing periods, and we will give you advance
        notice so you can decide whether to continue.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about billing or a refund? Contact us at{" "}
        <a href="mailto:support@androsinnovations.com">support@androsinnovations.com</a>.
      </p>
    </LegalDoc>
  );
}
