const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

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

  // Fetch class to get teacherId
  let teacherId = null;
  try {
    const classSnap = await admin.firestore().collection("classes").doc(classId).get();
    if (classSnap.exists) {
      teacherId = classSnap.data().teacherId;
    }
  } catch (err) {
    console.error("Error fetching class for teacherId:", err);
  }

  // Write to Firestore
  const attemptRef = admin.firestore().collection("quizAttempts").doc();
  await attemptRef.set({
    studentId,
    classId,
    teacherId, // Included for easier querying by teachers
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
    // We use a retry loop to give the client time to write the payload document.
    let payloadSnap = null;
    const payloadRef = admin.firestore().collection("registration_payloads").doc(uid);

    for (let i = 0; i < 5; i++) {
      payloadSnap = await payloadRef.get();
      if (payloadSnap.exists) break;
      
      console.log(`Payload not found for ${uid}, attempt ${i + 1}, retrying in 2s...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (payloadSnap && payloadSnap.exists) {
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
    } else {
      console.warn(`No registration payload found for user ${uid} after retries. Defaulting to student.`);
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

  const { classId } = data;
  if (!classId || typeof classId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "classId is required."
    );
  }

  try {
    const db = admin.firestore();

    const classSnap = await db.collection("classes").doc(classId).get();
    const classData = classSnap.exists ? classSnap.data() : null;
    const isOwner = classData && classData.teacherId === context.auth.uid;
    const isTA = classData && (classData.taIds || []).includes(context.auth.uid);
    if (!classSnap.exists || (!isOwner && !isTA)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Not authorized to view performance for this class.'
      );
    }

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

// ---------------------------------------------------------------------------
// getCalendarToken — HTTPS Callable
// Generates or retrieves a unique calendar token for the student.
// Stored in users/{uid}.calendarToken
// ---------------------------------------------------------------------------
exports.getCalendarToken = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }

  const uid = context.auth.uid;
  const userRef = admin.firestore().collection("users").doc(uid);
  const userDoc = await userRef.get();

  if (userDoc.exists && userDoc.data().calendarToken) {
    return { token: userDoc.data().calendarToken };
  }

  // Generate a unique token
  const crypto = require("crypto");
  const token = crypto.randomBytes(24).toString("hex");

  await userRef.set({ calendarToken: token }, { merge: true });

  return { token };
});

// ---------------------------------------------------------------------------
// calendarFeed — Public HTTP endpoint
// Serves a live .ics feed for a student based on their calendar token.
// URL: /calendarFeed?token=xxx
// Google Calendar subscribes to this URL and auto-refreshes.
// ---------------------------------------------------------------------------
exports.calendarFeed = functions.https.onRequest(async (req, res) => {
  try {
    const token = req.query.token;
    if (!token || typeof token !== "string" || token.length > 256 || token.length < 10) {
      res.status(400).send("Invalid token parameter.");
      return;
    }

    // Find the user with this calendar token
    const usersSnap = await admin.firestore()
      .collection("users")
      .where("calendarToken", "==", token)
      .limit(1)
      .get();

    if (usersSnap.empty) {
      res.status(404).send("Invalid calendar token.");
      return;
    }

    const userDoc = usersSnap.docs[0];
    const uid = userDoc.id;
    const userData = userDoc.data();

    // Get student's enrolled classes
    const classesSnap = await admin.firestore()
      .collection("classes")
      .where("studentIds", "array-contains", uid)
      .get();

    const classIds = classesSnap.docs.map(d => d.id);
    const classMap = {};
    classesSnap.docs.forEach(d => { classMap[d.id] = d.data(); });

    if (classIds.length === 0) {
      res.set("Content-Type", "text/calendar; charset=utf-8");
      res.send([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//TikiTaka//Assignments//EN",
        "X-WR-CALNAME:TikiTaka Schedule",
        "END:VCALENDAR",
      ].join("\r\n"));
      return;
    }

    // Fetch all assignments across enrolled classes (batch in groups of 10)
    const allAssignments = [];
    for (let i = 0; i < classIds.length; i += 10) {
      const batch = classIds.slice(i, i + 10);
      const assignSnap = await admin.firestore()
        .collection("assignments")
        .where("classId", "in", batch)
        .get();
      assignSnap.docs.forEach(d => allAssignments.push({ id: d.id, ...d.data() }));
    }

    // Check for per-student extension due dates
    const extensionDueDates = {};
    classesSnap.docs.forEach(d => {
      const data = d.data();
      const dueDatesMap = data.extensionDueDates || {};
      Object.entries(dueDatesMap).forEach(([key, val]) => {
        if (key.startsWith(uid + "_")) {
          const assignId = key.slice(uid.length + 1);
          extensionDueDates[assignId] = val.toDate ? val.toDate() : new Date(val);
        }
      });
    });

    // Build ICS
    const pad = (n) => n.toString().padStart(2, "0");
    const formatDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//TikiTaka//Assignments//EN",
      "X-WR-CALNAME:TikiTaka Schedule",
      "METHOD:PUBLISH",
    ];

    allAssignments.forEach(a => {
      if (!a.dueDate) return;

      const rawDue = a.dueDate.toDate ? a.dueDate.toDate() : new Date(a.dueDate);
      const dueDate = extensionDueDates[a.id] || rawDue;
      const nextDay = new Date(dueDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const className = classMap[a.classId]?.name || "Class";

      lines.push(
        "BEGIN:VEVENT",
        `UID:tikitaka-${a.id}@tikitaka.ai`,
        `DTSTART;VALUE=DATE:${formatDate(dueDate)}`,
        `DTEND;VALUE=DATE:${formatDate(nextDay)}`,
        `SUMMARY:📝 ${a.title} - Due`,
        `DESCRIPTION:Assignment due for ${className} (${a.totalPoints || 100} points)`,
        `LOCATION:TikiTaka - ${className}`,
        "BEGIN:VALARM",
        "TRIGGER:-P1D",
        "ACTION:DISPLAY",
        `DESCRIPTION:Reminder: "${a.title}" is due tomorrow!`,
        "END:VALARM",
        "END:VEVENT"
      );
    });

    // Fetch class schedule blocks (recurring class times)
    const teacherIds = [...new Set(classesSnap.docs.map(d => d.data().teacherId).filter(Boolean))];
    const dayToICS = { Monday: "MO", Tuesday: "TU", Wednesday: "WE", Thursday: "TH", Friday: "FR" };
    const dayToNum = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5 };

    for (let i = 0; i < teacherIds.length; i += 30) {
      const batch = teacherIds.slice(i, i + 30);
      const schedSnap = await admin.firestore()
        .collection("schedules")
        .where("teacherId", "in", batch)
        .get();

      schedSnap.docs.forEach(d => {
        const block = d.data();
        // Only include blocks for classes the student is enrolled in
        if (!classIds.includes(block.classId)) return;

        const className = classMap[block.classId]?.name || "Class";
        const icsDay = dayToICS[block.day];
        if (!icsDay) return;

        // Create a start date for the first occurrence (find next matching day)
        const now = new Date();
        const currentDayNum = now.getDay() === 0 ? 7 : now.getDay(); // 1=Mon
        const targetDayNum = dayToNum[block.day];
        let daysUntil = targetDayNum - currentDayNum;
        if (daysUntil < 0) daysUntil += 7;
        const startDate = new Date(now);
        startDate.setDate(now.getDate() + daysUntil);

        const [startH, startM] = block.startTime.split(":").map(Number);
        const [endH, endM] = block.endTime.split(":").map(Number);

        const formatDateTime = (d, h, m) =>
          `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(h)}${pad(m)}00`;

        lines.push(
          "BEGIN:VEVENT",
          `UID:tikitaka-sched-${d.id}@tikitaka.ai`,
          `DTSTART:${formatDateTime(startDate, startH, startM)}`,
          `DTEND:${formatDateTime(startDate, endH, endM)}`,
          `RRULE:FREQ=WEEKLY;BYDAY=${icsDay}`,
          `SUMMARY:📚 ${className}`,
          `DESCRIPTION:${className}${block.room ? " - Room: " + block.room : ""}`,
          block.room ? `LOCATION:${block.room}` : "",
          "END:VEVENT"
        );
      });
    }

    lines.push("END:VCALENDAR");

    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Cache-Control", "public, max-age=3600"); // Cache for 1 hour
    // Filter out any empty lines from optional fields
    res.send(lines.filter(l => l).join("\r\n"));
  } catch (err) {
    console.error("Calendar feed error:", err);
    res.status(500).send("Internal server error.");
  }
});

