const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------
const templates = {
  grade_released: (data) => ({
    subject: `Your grade for ${data.assignmentTitle} is available`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #0f766e;">Grade Released</h2>
        <p>You scored <strong>${data.score}/${data.totalPoints}</strong> (${data.percentage}%) on <strong>${data.assignmentTitle}</strong> in ${data.className}.</p>
        <a href="${data.link}" style="display: inline-block; background: #0f766e; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; margin-top: 12px;">View Feedback</a>
      </div>
    `,
  }),
  due_reminder: (data) => ({
    subject: `Due tomorrow: ${data.assignmentTitle} in ${data.className}`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #d97706;">Due Soon</h2>
        <p><strong>${data.assignmentTitle}</strong> is due ${data.dueDate}.</p>
        <a href="${data.link}" style="display: inline-block; background: #0f766e; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; margin-top: 12px;">Submit Now</a>
      </div>
    `,
  }),
  grade_appeal: (data) => ({
    subject: `Grade appeal from ${data.studentName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Grade Appeal</h2>
        <p><strong>${data.studentName}</strong> has appealed their grade on <strong>${data.assignmentTitle}</strong> in ${data.className}.</p>
        <a href="${data.link}" style="display: inline-block; background: #0f766e; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; margin-top: 12px;">Review Appeal</a>
      </div>
    `,
  }),
  appeal_response: (data) => ({
    subject: `Professor responded to your grade appeal`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #0f766e;">Appeal Response</h2>
        <p>${data.teacherName} has responded to your appeal for <strong>${data.assignmentTitle}</strong>.</p>
        <a href="${data.link}" style="display: inline-block; background: #0f766e; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; margin-top: 12px;">View Response</a>
      </div>
    `,
  }),
  class_invite: (data) => ({
    subject: `You've been enrolled in ${data.className} on TikiTaka Grader`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #0f766e;">You're Invited!</h2>
        <p>Professor ${data.teacherName} has added you to <strong>${data.className}</strong>.</p>
        <a href="${data.link}" style="display: inline-block; background: #0f766e; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; margin-top: 12px;">Sign Up / Log In</a>
        <p style="color: #666; font-size: 12px; margin-top: 16px;">If you already have an account, log in and you'll be automatically enrolled.</p>
      </div>
    `,
  }),
  announcement: (data) => ({
    subject: `New announcement in ${data.className}`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #0f766e;">New Announcement</h2>
        <p>${data.teacherName} posted in <strong>${data.className}</strong>:</p>
        <blockquote style="border-left: 3px solid #0f766e; padding-left: 12px; color: #444;">${data.message}</blockquote>
      </div>
    `,
  }),
};

// ---------------------------------------------------------------------------
// sendEmailNotification — Firestore trigger on notifications collection
// ---------------------------------------------------------------------------
// This function fires when a notification is written with sendEmail: true.
// It uses Resend (via API key in env) to send the email.
// In emulator mode, it logs the email instead of sending.
// ---------------------------------------------------------------------------
exports.sendEmailNotification = functions.firestore
  .document("notifications/{notificationId}")
  .onCreate(async (snap, context) => {
    const notification = snap.data();

    // Only process if email flag is set
    if (!notification.sendEmail) return;

    const recipientId = notification.recipientId;
    if (!recipientId) return;

    try {
      // Get recipient's email
      const userDoc = await db.collection("users").doc(recipientId).get();
      if (!userDoc.exists) return;

      const userData = userDoc.data();
      const email = userData.email;

      // Check if user has email notifications enabled
      if (userData.settings?.emailNotifications === false) {
        console.log(`Email notifications disabled for ${email}`);
        return;
      }

      // Get template
      const templateFn = templates[notification.type];
      if (!templateFn) {
        console.log(`No email template for type: ${notification.type}`);
        return;
      }

      const { subject, html } = templateFn(notification.data || {});

      // Check for Resend API key.
      // Functions v1 `functions.config()` was deprecated by Firebase in
      // favour of v2 secrets / `process.env`. We read from process.env only;
      // set RESEND_API_KEY in the function environment (or as a Firebase
      // Secret bound at deploy time) — see README/SETUP_GUIDE.
      const apiKey = process.env.RESEND_API_KEY;

      if (!apiKey) {
        // Emulator mode — just log
        console.log("=== EMAIL (emulator mode) ===");
        console.log(`To: ${email}`);
        console.log(`Subject: ${subject}`);
        console.log("============================");

        // Record in sentEmails for debugging
        await db.collection("sentEmails").add({
          to: email,
          subject,
          type: notification.type,
          recipientId,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          emulator: true,
        });
        return;
      }

      // Production mode — send via Resend
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "TikiTaka Grader <notifications@tikitaka.ai>",
          to: [email],
          subject,
          html,
        }),
      });

      const result = await response.json();

      // Record sent email
      await db.collection("sentEmails").add({
        to: email,
        subject,
        type: notification.type,
        recipientId,
        resendId: result.id,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        emulator: false,
      });

      console.log(`Email sent to ${email}: ${subject}`);
    } catch (err) {
      console.error("Email notification error:", err);
    }
  });

// ---------------------------------------------------------------------------
// sendPushNotification — Firestore trigger for push notifications
// ---------------------------------------------------------------------------
exports.sendPushNotification = functions.firestore
  .document("notifications/{notificationId}")
  .onCreate(async (snap, context) => {
    const notification = snap.data();

    // Only process if push flag is set
    if (!notification.sendPush) return;

    const recipientId = notification.recipientId;
    if (!recipientId) return;

    try {
      // FCM tokens live in the owner-only private subcollection so they
      // do not leak through the broad users/{uid} read rule.
      const privateDoc = await db
        .collection("users").doc(recipientId)
        .collection("private").doc("notifications")
        .get();
      const tokens = (privateDoc.exists && privateDoc.data().fcmTokens) || [];

      if (tokens.length === 0) return;

      const title = notification.title || "TikiTaka Grader";
      const body = notification.body || notification.message || "";
      const link = notification.data?.link || "/";

      const message = {
        tokens,
        notification: { title, body },
        webpush: { fcmOptions: { link } },
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      // Clean up invalid tokens
      const invalidTokens = [];
      response.responses.forEach((resp, i) => {
        if (!resp.success && resp.error?.code === "messaging/invalid-registration-token") {
          invalidTokens.push(tokens[i]);
        }
      });

      if (invalidTokens.length > 0) {
        await db
          .collection("users").doc(recipientId)
          .collection("private").doc("notifications")
          .set(
            { fcmTokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens) },
            { merge: true }
          );
      }

      console.log(`Push sent to ${recipientId}: ${response.successCount}/${tokens.length} delivered`);
    } catch (err) {
      console.error("Push notification error:", err);
    }
  });
