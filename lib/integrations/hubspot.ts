import "server-only";

/** HubSpot CRM calls with an OAuth access token. */

export async function getHubSpotAccount(accessToken: string): Promise<string | null> {
  const res = await fetch(
    `https://api.hubapi.com/oauth/v1/access-tokens/${accessToken}`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { hub_domain?: string; user?: string };
  return json.hub_domain ?? json.user ?? "HubSpot account";
}

/** Create or update a contact by email. Returns the contact id. */
export async function upsertContact(
  accessToken: string,
  contact: { email: string; firstname?: string; lastname?: string },
): Promise<{ id: string; created: boolean }> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  const properties = {
    email: contact.email,
    ...(contact.firstname ? { firstname: contact.firstname } : {}),
    ...(contact.lastname ? { lastname: contact.lastname } : {}),
  };

  // Try create; on 409 (already exists) fall back to update by email.
  const createRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "POST",
    headers,
    body: JSON.stringify({ properties }),
  });
  if (createRes.ok) {
    const json = (await createRes.json()) as { id: string };
    return { id: json.id, created: true };
  }
  if (createRes.status === 409) {
    const updateRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contact.email)}?idProperty=email`,
      { method: "PATCH", headers, body: JSON.stringify({ properties }) },
    );
    if (updateRes.ok) {
      const json = (await updateRes.json()) as { id: string };
      return { id: json.id, created: false };
    }
    const err = (await updateRes.json()) as { message?: string };
    throw new Error(`HubSpot update failed: ${err.message ?? updateRes.status}`);
  }
  const err = (await createRes.json()) as { message?: string };
  throw new Error(`HubSpot create failed: ${err.message ?? createRes.status}`);
}
