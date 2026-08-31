import { LegalDoc } from "../doc";

export const metadata = {
  title: "Privacy Policy — Operator",
  description: "How Operator by Andros Innovations collects, uses, and protects your data.",
};

/* TEMPLATE — a solid starting draft. Have counsel review before you rely on it.
   Google OAuth verification requires a public, accurate privacy policy that
   discloses how you use Google user data and honors Google's Limited Use rules. */
export default function PrivacyPage() {
  return (
    <LegalDoc title="Privacy Policy" updated="August 30, 2026">
      <p>
        This Privacy Policy explains how Andros Innovations (&ldquo;we,&rdquo; &ldquo;us&rdquo;) collects, uses, and
        protects information when you use Operator. We aim to collect only what we need to run the service for you.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Account information</strong> — your name, email, and workspace details.</li>
        <li><strong>Content you provide</strong> — tasks, notes, documents, goals, and messages you create in Operator.</li>
        <li><strong>Connected-service data</strong> — when you authorize an integration (e.g. email, calendar, CRM,
          social, payments), we access the data needed to provide the features you use, within the scopes you grant.</li>
        <li><strong>Usage data</strong> — logs, device and browser information, and interactions with the service, used
          to operate, secure, and improve it.</li>
        <li><strong>Payment data</strong> — subscriptions are processed by our payment provider (Stripe). We receive
          billing status and identifiers, not full card numbers.</li>
      </ul>

      <h2>How we use information</h2>
      <ul>
        <li>to provide, maintain, and improve Operator and its features;</li>
        <li>to generate AI drafts, recommendations, and analysis you request;</li>
        <li>to prepare or take actions you approve through connected accounts;</li>
        <li>to communicate with you about your account, security, and service updates;</li>
        <li>to detect, prevent, and address fraud, abuse, and technical issues.</li>
      </ul>

      <h2>AI processing</h2>
      <p>
        To power its agents, Operator sends relevant content to our AI provider, Anthropic, to generate output. This
        processing happens to fulfill your requests. We do not use your content to train third-party foundation models,
        and we do not sell your content.
      </p>

      <h2>Google user data</h2>
      <p>
        If you connect Google services (Gmail, Calendar, Drive/Sheets), Operator&rsquo;s use of information received
        from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
          Google API Services User Data Policy
        </a>
        , including its Limited Use requirements. We use Google data only to provide and improve the features you enable
        (such as reading a thread to draft a reply, or adding an event to your calendar), never for advertising, and we
        do not transfer it except as needed to provide the service or as required by law. You can revoke access at any
        time in your Google account settings or by disconnecting the integration in Operator.
      </p>

      <h2>How we share information</h2>
      <p>We do not sell your personal information. We share it only with:</p>
      <ul>
        <li><strong>Service providers</strong> that run our infrastructure — for example Supabase (database/auth),
          Vercel (hosting), Anthropic (AI), and Stripe (payments) — under agreements that limit their use of it;</li>
        <li><strong>Services you connect</strong>, to carry out the actions you request;</li>
        <li><strong>Legal and safety</strong> recipients, when required by law or to protect rights and safety.</li>
      </ul>

      <h2>Data retention</h2>
      <p>
        We keep your information for as long as your account is active or as needed to provide the service, comply with
        legal obligations, resolve disputes, and enforce agreements. You can delete your account from Settings, which
        removes your workspace data and disconnects integrations.
      </p>

      <h2>Security</h2>
      <p>
        We use technical and organizational measures to protect your data, including encryption in transit and at rest
        for stored credentials. No method of transmission or storage is completely secure, so we cannot guarantee
        absolute security.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live, you may have rights to access, correct, export, or delete your personal
        information, and to object to or restrict certain processing. To exercise these rights, contact us at the
        address below.
      </p>

      <h2>Cookies</h2>
      <p>
        We use essential cookies to keep you signed in and to operate the service. We do not use third-party
        advertising cookies.
      </p>

      <h2>Children</h2>
      <p>Operator is not directed to children under 18, and we do not knowingly collect their information.</p>

      <h2>Changes to this policy</h2>
      <p>
        We may update this policy from time to time. If we make material changes, we will provide reasonable notice and
        update the date above.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests? Contact us at{" "}
        <a href="mailto:privacy@androsinnovations.com">privacy@androsinnovations.com</a>.
      </p>
    </LegalDoc>
  );
}
