// Flutterwave API client — test mode only.
// This system never touches card details (PCI scope). Flutterwave handles that.
// All amounts sent to Flutterwave are in major units (naira), so we convert
// from our internal minor-unit (kobo) representation at the boundary.

const FLW_BASE_URL = "https://api.flutterwave.com/v3";

function getSecretKey(): string {
  const key = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!key) {
    throw new Error("FLUTTERWAVE_SECRET_KEY is not set");
  }
  return key;
}

export interface FlutterwavePaymentInit {
  /** The Flutterwave-hosted payment link */
  link: string;
}

/**
 * Initialize a payment via Flutterwave Standard.
 * Returns a redirect URL for the customer to complete payment on Flutterwave's page.
 */
export async function initializePayment(params: {
  txRef: string;
  amountMinor: number;
  currency: string;
  customerEmail: string;
  customerName: string;
  redirectUrl: string;
  title: string;
}): Promise<FlutterwavePaymentInit> {
  // Flutterwave accepts amounts in major units
  const amountMajor = params.amountMinor / 100;

  const response = await fetch(`${FLW_BASE_URL}/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tx_ref: params.txRef,
      amount: amountMajor,
      currency: params.currency,
      redirect_url: params.redirectUrl,
      customer: {
        email: params.customerEmail,
        name: params.customerName,
      },
      customizations: {
        title: params.title,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Flutterwave payment init failed: ${response.status} — ${text}`);
  }

  const json = await response.json();

  if (json.status !== "success" || !json.data?.link) {
    throw new Error(`Flutterwave returned unexpected response: ${JSON.stringify(json)}`);
  }

  return { link: json.data.link };
}

export interface FlutterwaveVerification {
  status: string;
  txRef: string;
  flwRef: string;
  amountMajor: number;
  currency: string;
  customerEmail: string;
  rawPayload: Record<string, unknown>;
}

/**
 * Verify a transaction by its ID — server-side only.
 * This is the authoritative check that payment actually happened.
 * Never grant entitlement without calling this first.
 */
export async function verifyTransaction(
  transactionId: string
): Promise<FlutterwaveVerification> {
  const response = await fetch(
    `${FLW_BASE_URL}/transactions/${transactionId}/verify`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Flutterwave verification failed: ${response.status} — ${text}`);
  }

  const json = await response.json();

  if (json.status !== "success") {
    throw new Error(`Flutterwave verify returned: ${JSON.stringify(json)}`);
  }

  const data = json.data;

  return {
    status: data.status,
    txRef: data.tx_ref,
    flwRef: data.flw_ref,
    amountMajor: data.amount,
    currency: data.currency,
    customerEmail: data.customer?.email ?? "",
    rawPayload: data,
  };
}

/**
 * Verify a Flutterwave webhook signature.
 * Compares the `verif-hash` header against our stored webhook secret.
 * Returns false if the signature doesn't match — do not process the event.
 */
export function verifyWebhookSignature(verifHash: string | null): boolean {
  const secret = process.env.FLUTTERWAVE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("FLUTTERWAVE_WEBHOOK_SECRET is not set — rejecting webhook");
    return false;
  }
  return verifHash === secret;
}
