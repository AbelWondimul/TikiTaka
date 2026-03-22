const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

// ---------------------------------------------------------------------------
// Rate Limiting Helper
// ---------------------------------------------------------------------------
const checkRateLimit = async (uid, action, limit) => {
  const todayStr = new Date().toISOString().split('T')[0];
  const usageRef = admin.firestore().collection('users').doc(uid).collection('dailyUsage').doc(todayStr);
  
  const snap = await usageRef.get();
  let currentCount = 0;
  if (snap.exists) {
    currentCount = snap.data()[action] || 0;
  }
  
  if (currentCount >= limit) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Daily limit of ${limit} for ${action} exceeded.`
    );
  }
  
  await usageRef.set({
    [action]: admin.firestore.FieldValue.increment(1)
  }, { merge: true });
};


// ---------------------------------------------------------------------------
// submitQuiz — HTTPS Callable (v1 onCall)
// ---------------------------------------------------------------------------
exports.submitQuiz = functions.https.onCall(async (data, context) => {
  // Auth check
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }

  const studentId = context.auth.uid;
  await checkRateLimit(studentId, 'submitQuiz', 30);
  const { questions, answers, classId, quizId } = data;

  // Validate input
  if (!classId || typeof classId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "classId is required."
    );
  }
  if (!Array.isArray(questions) || questions.length !== 10) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "questions must be an array of exactly 10 items."
    );
  }
  if (!answers || typeof answers !== "object") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "answers is required and must be an object."
    );
  }

  if (quizId && typeof quizId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "quizId must be a string."
    );
  }

  // Score the attempt
  let correct = 0;
  const topicGaps = [];
  const enrichedQuestions = questions.map((q, index) => {
    const studentAnswer = answers[index] || null;
    const isCorrect = studentAnswer === q.answer;
    if (isCorrect) {
      correct++;
    } else {
      // Collect topic for wrong answers
      if (q.topic) {
        topicGaps.push(q.topic);
      }
    }
    return {
      question: q.question,
      options: q.options,
      answer: q.answer,
      hint: q.hint,
      topic: q.topic,
      studentAnswer,
      correct: isCorrect,
    };
  });

  const score = (correct / 10) * 100;

  // Write to Firestore
  const attemptRef = admin.firestore().collection("quizAttempts").doc();
  await attemptRef.set({
    studentId,
    classId,
    quizId: quizId || null,
    score,
    topicGaps,
    questions: enrichedQuestions,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    score,
    topicGaps,
    questions: enrichedQuestions,
  };
});

// ---------------------------------------------------------------------------
// onUserCreate — Auth trigger (kept from previous iteration)
// ---------------------------------------------------------------------------
exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
  try {
    const uid = user.uid;
    const email = user.email || "";
    let displayName = user.displayName || "";
    let role = "student";

    // Since a standard auth.user().onCreate trigger does not receive client-side registration payloads,
    // we read from a temporary Firestore collection `registration_payloads` that the client
    // writes to immediately before or after account creation.
    // We add a slight delay to ensure the client has time to write the payload document.
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const payloadRef = admin.firestore().collection("registration_payloads").doc(uid);
    const payloadSnap = await payloadRef.get();

    if (payloadSnap.exists) {
      const payloadData = payloadSnap.data();
      
      // Update display name if it was passed in the payload
      if (payloadData.displayName && !displayName) {
        displayName = payloadData.displayName;
        await admin.auth().updateUser(uid, { displayName });
      }

      // Use the role selected by the user during registration
      if (payloadData.role === "teacher" || payloadData.role === "student") {
        role = payloadData.role;
      }

      // Clean up the temporary payload document
      await payloadRef.delete();
    }

    // Set custom user claims
    await admin.auth().setCustomUserClaims(uid, { role });

    // Write the official user document
    await admin.firestore().collection("users").doc(uid).set({
      uid,
      email,
      displayName,
      role,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Successfully created user ${uid} with role ${role}`);
  } catch (error) {
    console.error("Error in onUserCreate:", error);
  }
});

// ---------------------------------------------------------------------------
// getClassPerformance — HTTPS Callable (v1 onCall)
// "Use this instead of client-side aggregation when student count exceeds ~30"
// ---------------------------------------------------------------------------
exports.getClassPerformance = functions.https.onCall(async (data, context) => {
  // Auth check
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }

  const uid = context.auth.uid;
  await checkRateLimit(uid, 'getClassPerformance', 30);
  const { classId } = data;
  if (!classId || typeof classId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "classId is required."
    );
  }

  try {
    const db = admin.firestore();

    const [jobsSnap, quizSnap] = await Promise.all([
      db.collection("gradingJobs").where("classId", "==", classId).get(),
      db.collection("quizAttempts").where("classId", "==", classId).get()
    ]);

    const jobs = jobsSnap.docs.map(doc => doc.data());
    const quizzes = quizSnap.docs.map(doc => doc.data());

    // Calculate Aggregates
    const completedJobs = jobs.filter(j => j.score !== null);
    const avgGrade = completedJobs.length > 0 
      ? completedJobs.reduce((sum, j) => sum + j.score, 0) / completedJobs.length 
      : 0;

    const avgQuiz = quizzes.length > 0 
      ? quizzes.reduce((sum, q) => sum + q.score, 0) / quizzes.length 
      : 0;

    const gapCounts = {};
    quizzes.forEach(q => {
      if (q.topicGaps) {
        q.topicGaps.forEach(topic => {
          gapCounts[topic] = (gapCounts[topic] || 0) + 1;
        });
      }
    });
    const topGaps = Object.entries(gapCounts)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const distributionGroups = [
      { range: '0-59', count: 0 },
      { range: '60-69', count: 0 },
      { range: '70-79', count: 0 },
      { range: '80-89', count: 0 },
      { range: '90-100', count: 0 }
    ];
    completedJobs.forEach(j => {
      const score = j.score;
      if (score < 60) distributionGroups[0].count++;
      else if (score < 70) distributionGroups[1].count++;
      else if (score < 80) distributionGroups[2].count++;
      else if (score < 90) distributionGroups[3].count++;
      else distributionGroups[4].count++;
    });

    return {
      avgGrade: Math.round(avgGrade),
      avgQuiz: Math.round(avgQuiz),
      topGaps,
      distribution: distributionGroups
    };

  } catch (error) {
    console.error("Error in getClassPerformance:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to fetch performance data."
    );
  }
});

