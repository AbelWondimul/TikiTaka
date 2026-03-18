/**
 * firestore-schema.js
 * Reference file defining the document shapes for Firestore collections.
 * Not deployed to Firebase. Used for developer reference and seeding.
 */

const schema = {
  // Collection: users
  "/users/{uid}": {
    uid: "string",
    email: "string",
    displayName: "string",
    role: "'teacher' | 'student'",
    createdAt: "timestamp"
  },

  // Collection: classes
  "/classes/{classId}": {
    classId: "string",
    teacherId: "string",
    name: "string",
    classCode: "string (6-character alphanumeric)",
    studentIds: ["string"], // Array of student uids
    createdAt: "timestamp"
  },

  // Collection: knowledgeBase
  "/knowledgeBase/{docId}": {
    docId: "string",
    classId: "string",
    teacherId: "string",
    title: "string",
    storageUrl: "string",
    uploadedAt: "timestamp"
  },

  // Collection: gradingJobs
  "/gradingJobs/{jobId}": {
    jobId: "string",
    classId: "string",
    studentId: "string",
    teacherId: "string",
    rawPdfUrl: "string",
    resultPdfUrl: "string | null",
    rubric: "string",
    status: "'queued' | 'processing' | 'complete' | 'error'",
    score: "number | null",
    feedback: "string | null", // Overall feedback
    createdAt: "timestamp",
    completedAt: "timestamp | null"
  },

  // Collection: quizAttempts
  "/quizAttempts/{attemptId}": {
    attemptId: "string",
    studentId: "string",
    classId: "string",
    score: "number",
    topicGaps: ["string"],
    questions: [
      {
        question: "string",
        options: ["string"],
        answer: "string", // the correct answer
        hint: "string",
        topic: "string",
        studentAnswer: "string | null",
        correct: "boolean"
      }
    ],
    createdAt: "timestamp"
  }
};

export default schema;
