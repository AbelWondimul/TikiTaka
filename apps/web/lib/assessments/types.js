/**
 * @typedef {Object} Assessment
 * @property {string} id
 * @property {string} classId
 * @property {string} teacherId
 * @property {string} title
 * @property {string} description
 * @property {string} instructions
 * @property {'draft'|'published'|'closed'|'archived'} status
 * @property {Date|null} opensAt
 * @property {Date|null} closesAt
 * @property {number|null} timeLimitMinutes
 * @property {boolean} showTimer
 * @property {boolean} allowMultipleAttempts
 * @property {number} maxAttempts
 * @property {boolean} randomizeQuestions
 * @property {boolean} randomizeAnswers
 * @property {number|null} questionsToShow
 * @property {boolean} browserLockdown
 * @property {number} lockdownViolationsAllowed
 * @property {boolean} autoSubmitOnTimerEnd
 * @property {number} gracePeriodMinutes
 * @property {boolean} releaseGradesImmediately
 * @property {Date|null} releaseGradesAt
 * @property {boolean} showCorrectAnswers
 * @property {Date|null} showCorrectAnswersAt
 * @property {boolean} allowLateSubmissions
 * @property {number} latePenaltyPercent
 * @property {string|null} customCss
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} Question
 * @property {string} id
 * @property {string} assessmentId
 * @property {string|null} questionBankId
 * @property {'multiple_choice'|'true_false'|'short_answer'|'essay'|'coding'} type
 * @property {number} orderIndex
 * @property {Object} content - TipTap JSON content
 * @property {Array<{url: string, type: string, alt?: string}>} media
 * @property {number} points
 * @property {boolean} required
 * @property {string|null} codingLanguage
 * @property {string|null} codingStarterCode
 * @property {Array<{input: string, expectedOutput: string, hidden?: boolean}>|null} codingTestCases
 * @property {boolean} codingShowTestCases
 * @property {string|null} customHtml
 * @property {boolean} [allowPartialCredit]
 * @property {boolean} [autoGrade]
 * @property {boolean} [caseSensitive]
 * @property {string[]} [acceptedAnswers]
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} AnswerChoice
 * @property {string} id
 * @property {string} questionId
 * @property {Object} content - TipTap JSON content
 * @property {boolean} isCorrect
 * @property {number} orderIndex
 * @property {string|null} explanation
 */

/**
 * @typedef {Object} Submission
 * @property {string} id
 * @property {string} assessmentId
 * @property {string} studentId
 * @property {number} attemptNumber
 * @property {Date} startedAt
 * @property {Date|null} submittedAt
 * @property {boolean} autoSubmitted
 * @property {boolean} isLate
 * @property {number} timeSpentSeconds
 * @property {number|null} score
 * @property {number|null} maxScore
 * @property {number|null} percentage
 * @property {Date|null} gradedAt
 * @property {string|null} gradedBy
 * @property {Array<{type: string, timestamp: Date}>} violations
 * @property {'in_progress'|'submitted'|'graded'} status
 */

/**
 * @typedef {Object} QuestionResponse
 * @property {string} id
 * @property {string} submissionId
 * @property {string} questionId
 * @property {string[]} answerChoiceIds
 * @property {string|null} textResponse
 * @property {string|null} codeResponse
 * @property {number|null} pointsEarned
 * @property {boolean|null} isCorrect
 * @property {string|null} feedback
 * @property {Date|null} gradedAt
 * @property {boolean} autoGraded
 */

/**
 * @typedef {Object} AssessmentExtension
 * @property {string} id
 * @property {string} assessmentId
 * @property {string} studentId
 * @property {number|null} extraTimeMinutes
 * @property {Date|null} newCloseDate
 * @property {number|null} extraAttempts
 * @property {string|null} note
 * @property {string} grantedBy
 * @property {Date} createdAt
 */

/**
 * @typedef {Object} QuestionBank
 * @property {string} id
 * @property {string} teacherId
 * @property {string} name
 * @property {string} description
 * @property {string|null} classId
 * @property {boolean} isShared
 * @property {string[]} tags
 * @property {Date} createdAt
 */

/**
 * Question type definitions with labels and icons
 */
export const QUESTION_TYPES = {
  multiple_choice: { label: 'Multiple Choice', icon: 'CircleDot' },
  true_false: { label: 'True / False', icon: 'ToggleLeft' },
  short_answer: { label: 'Short Answer', icon: 'Type' },
  essay: { label: 'Essay', icon: 'FileText' },
  coding: { label: 'Coding', icon: 'Code' },
};

/**
 * Assessment status definitions with labels and colors
 */
export const ASSESSMENT_STATUSES = {
  draft: { label: 'Draft', color: 'gray' },
  published: { label: 'Published', color: 'green' },
  closed: { label: 'Closed', color: 'orange' },
  archived: { label: 'Archived', color: 'red' },
};

/**
 * Default assessment object with sensible defaults
 * @type {Partial<Assessment>}
 */
export const DEFAULT_ASSESSMENT = {
  title: '',
  description: '',
  instructions: '',
  status: 'draft',
  opensAt: null,
  closesAt: null,
  timeLimitMinutes: null,
  showTimer: true,
  allowMultipleAttempts: false,
  maxAttempts: 1,
  randomizeQuestions: false,
  randomizeAnswers: false,
  questionsToShow: null,
  browserLockdown: false,
  lockdownViolationsAllowed: 3,
  autoSubmitOnTimerEnd: true,
  gracePeriodMinutes: 0,
  releaseGradesImmediately: true,
  releaseGradesAt: null,
  showCorrectAnswers: false,
  showCorrectAnswersAt: null,
  allowLateSubmissions: false,
  latePenaltyPercent: 10,
  customCss: null,
};
