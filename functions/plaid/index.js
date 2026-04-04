const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Configuration, PlaidApi, PlaidEnvironments } = require("plaid");

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || "sandbox"],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

/**
 * Creates a Plaid Link Token
 */
exports.createPlaidLinkToken = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be logged in.");
  }

  const userId = context.auth.uid;

  try {
    const configs = {
      user: { client_user_id: userId },
      client_name: "Grader App",
      products: ["auth", "transactions"],
      country_codes: ["US"],
      language: "en",
    };

    const response = await plaidClient.linkTokenCreate(configs);
    return { link_token: response.data.link_token };
  } catch (error) {
    console.error("Plaid Link Token Error:", error.response?.data || error.message);
    throw new functions.https.HttpsError("internal", "Could not create Plaid Link Token.");
  }
});

/**
 * Exchanges a Public Token for an Access Token
 */
exports.exchangePlaidPublicToken = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be logged in.");
  }

  const { public_token, institution_id, institution_name } = data;
  const userId = context.auth.uid;

  try {
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: public_token,
    });

    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;

    // Save Access Token securely to Firestore (encrypted or in a private collection)
    // For now, we'll save it to a subcollection of the user
    await admin.firestore()
      .collection("users")
      .doc(userId)
      .collection("plaid_items")
      .doc(itemId)
      .set({
        access_token: accessToken, // IMPORTANT: In production, encrypt this!
        item_id: itemId,
        institution_id: institution_id || null,
        institution_name: institution_name || null,
        linked_at: admin.firestore.FieldValue.serverTimestamp(),
        status: "active",
      });

    return { success: true };
  } catch (error) {
    console.error("Plaid Token Exchange Error:", error.response?.data || error.message);
    throw new functions.https.HttpsError("internal", "Could not exchange Plaid Public Token.");
  }
});
