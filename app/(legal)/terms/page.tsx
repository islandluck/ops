import { LegalDoc } from "../doc";

export const metadata = {
  title: "Terms of Service — Operator",
  description: "The terms governing your use of Operator by Andros Innovations.",
};

/* TEMPLATE — a solid starting draft. Have counsel review before you rely on it. */
export default function TermsPage() {
  return (
    <LegalDoc title="Terms of Service" updated="August 30, 2026">
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of Operator, a software product
        provided by Andros Innovations (&ldquo;Andros,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;). By creating an
        account or using the service, you agree to these Terms. If you are using Operator on behalf of an
        organization, you represent that you have authority to bind that organization.
      </p>

      <h2>1. The service</h2>
      <p>
        Operator is an AI-assisted operations platform: software agents draft work, surface recommendations, and —
        where you connect third-party accounts and grant permission — prepare or take actions on your behalf. Operator
        is designed to keep a human in the loop; you are responsible for reviewing and approving actions before they
        take effect.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You must provide accurate account information and keep your credentials secure. You are responsible for all
        activity under your account. Notify us promptly of any unauthorized use. You must be at least 18 years old to
        use Operator.
      </p>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use Operator to violate any law or the rights of others;</li>
        <li>send spam, run unauthorized bulk outreach, or breach the terms of any connected third-party service;</li>
        <li>attempt to disrupt, reverse-engineer, or gain unauthorized access to the service or its infrastructure;</li>
        <li>upload malware or content you do not have the right to use.</li>
      </ul>

      <h2>4. AI-generated output &amp; automation</h2>
      <p>
        Operator uses artificial intelligence to generate drafts, suggestions, and analysis. Output may be inaccurate,
        incomplete, or unsuitable for your purpose. It is not professional, legal, financial, medical, or investment
        advice. <strong>You are solely responsible for reviewing all output and any action taken through the
        service</strong>, including messages sent, content published, and transactions made via connected accounts.
      </p>

      <h2>5. Third-party integrations</h2>
      <p>
        Operator connects to services you authorize (such as email, calendar, CRM, social, and payment providers). Your
        use of those services is governed by their own terms and privacy policies. We access and act on your connected
        data only as needed to provide the features you use, and only within the scopes you grant. You can disconnect
        an integration at any time.
      </p>

      <h2>6. Subscriptions &amp; billing</h2>
      <p>
        Paid plans are billed in advance on a recurring basis through our payment processor. Fees are described at the
        point of purchase. Unless stated otherwise, subscriptions renew automatically until cancelled. You can cancel or
        change your plan at any time; see our <a href="/refunds">Refund Policy</a> for how cancellations and refunds
        are handled. We may change prices with notice for future billing periods.
      </p>

      <h2>7. Your content</h2>
      <p>
        You retain ownership of the data and content you provide (&ldquo;Your Content&rdquo;). You grant us a limited
        license to host, process, and transmit Your Content solely to operate and improve the service for you. We do
        not sell Your Content.
      </p>

      <h2>8. Intellectual property</h2>
      <p>
        Operator, including its software, design, and trademarks, is owned by Andros Innovations and protected by
        applicable law. These Terms do not grant you any right to our intellectual property except the limited right to
        use the service as permitted here.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        The service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties of any kind,
        express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not
        warrant that the service will be uninterrupted, error-free, or that AI output will be accurate.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, Andros Innovations will not be liable for indirect, incidental,
        special, consequential, or punitive damages, or for lost profits, revenue, data, or goodwill. Our total
        liability for any claim relating to the service is limited to the amounts you paid us in the twelve months
        before the event giving rise to the claim.
      </p>

      <h2>11. Termination</h2>
      <p>
        You may stop using Operator at any time. We may suspend or terminate your access if you breach these Terms or
        if necessary to protect the service or other users. On termination, your right to use the service ends; certain
        provisions (such as ownership, disclaimers, and limitation of liability) survive.
      </p>

      <h2>12. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. If we make material changes, we will provide reasonable notice.
        Your continued use after changes take effect constitutes acceptance.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about these Terms? Contact us at <a href="mailto:support@androsinnovations.com">support@androsinnovations.com</a>.
      </p>
    </LegalDoc>
  );
}
