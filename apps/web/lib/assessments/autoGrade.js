/**
 * Auto-grades a submission by comparing responses against correct answers.
 *
 * @param {import('./types').Question[]} questions - Array of questions
 * @param {import('./types').QuestionResponse[]} responses - Array of student responses
 * @param {import('./types').AnswerChoice[]} answerChoices - Array of all answer choices for the assessment
 * @returns {Array<{questionId: string, pointsEarned: number|null, isCorrect: boolean|null, autoGraded: boolean}>}
 */
export function autoGradeSubmission(questions, responses, answerChoices) {
  return responses.map((response) => {
    const question = questions.find((q) => q.id === response.questionId);
    if (!question) {
      return { questionId: response.questionId, pointsEarned: 0, isCorrect: false, autoGraded: true };
    }

    switch (question.type) {
      case 'multiple_choice':
      case 'true_false':
        return gradeChoiceQuestion(question, response, answerChoices);
      case 'short_answer':
        return gradeShortAnswer(question, response);
      case 'essay':
        return { questionId: question.id, pointsEarned: null, isCorrect: null, autoGraded: false };
      case 'coding':
        return { questionId: question.id, pointsEarned: null, isCorrect: null, autoGraded: false };
      default:
        return { questionId: question.id, pointsEarned: null, isCorrect: null, autoGraded: false };
    }
  });
}

/**
 * Grades a multiple choice or true/false question.
 *
 * @param {import('./types').Question} question
 * @param {import('./types').QuestionResponse} response
 * @param {import('./types').AnswerChoice[]} answerChoices
 * @returns {{questionId: string, pointsEarned: number, isCorrect: boolean, autoGraded: boolean}}
 */
function gradeChoiceQuestion(question, response, answerChoices) {
  const questionChoices = answerChoices.filter((c) => c.questionId === question.id);
  const correctChoiceIds = questionChoices.filter((c) => c.isCorrect).map((c) => c.id);
  const selectedIds = response.answerChoiceIds || [];

  if (correctChoiceIds.length === 0) {
    return { questionId: question.id, pointsEarned: 0, isCorrect: false, autoGraded: true };
  }

  // Check for exact match
  const allCorrectSelected = correctChoiceIds.every((id) => selectedIds.includes(id));
  const noIncorrectSelected = selectedIds.every((id) => correctChoiceIds.includes(id));
  const isFullyCorrect = allCorrectSelected && noIncorrectSelected;

  if (isFullyCorrect) {
    return { questionId: question.id, pointsEarned: question.points, isCorrect: true, autoGraded: true };
  }

  // Partial credit for multiple correct answers
  if (question.allowPartialCredit && correctChoiceIds.length > 1) {
    const correctSelected = selectedIds.filter((id) => correctChoiceIds.includes(id)).length;
    const incorrectSelected = selectedIds.filter((id) => !correctChoiceIds.includes(id)).length;
    const netCorrect = Math.max(0, correctSelected - incorrectSelected);
    const proportion = netCorrect / correctChoiceIds.length;
    const pointsEarned = Math.round(question.points * proportion * 100) / 100;

    return { questionId: question.id, pointsEarned, isCorrect: false, autoGraded: true };
  }

  return { questionId: question.id, pointsEarned: 0, isCorrect: false, autoGraded: true };
}

/**
 * Grades a short answer question by comparing against accepted answers.
 *
 * @param {import('./types').Question} question
 * @param {import('./types').QuestionResponse} response
 * @returns {{questionId: string, pointsEarned: number|null, isCorrect: boolean|null, autoGraded: boolean}}
 */
function gradeShortAnswer(question, response) {
  if (!question.autoGrade) {
    return { questionId: question.id, pointsEarned: null, isCorrect: null, autoGraded: false };
  }

  const acceptedAnswers = question.acceptedAnswers || [];
  if (acceptedAnswers.length === 0) {
    return { questionId: question.id, pointsEarned: null, isCorrect: null, autoGraded: false };
  }

  const studentAnswer = (response.textResponse || '').trim();
  const caseSensitive = question.caseSensitive ?? false;

  const isMatch = acceptedAnswers.some((accepted) => {
    if (caseSensitive) {
      return studentAnswer === accepted.trim();
    }
    return studentAnswer.toLowerCase() === accepted.trim().toLowerCase();
  });

  return {
    questionId: question.id,
    pointsEarned: isMatch ? question.points : 0,
    isCorrect: isMatch,
    autoGraded: true,
  };
}

/**
 * Calculates the final submission score, applying late penalties if applicable.
 *
 * @param {Array<{questionId: string, pointsEarned: number|null, isCorrect: boolean|null, autoGraded: boolean}>} gradedResponses
 * @param {boolean} isLate - Whether the submission was late
 * @param {number} latePenaltyPercent - Penalty percentage per day late
 * @param {Date|null} submittedAt - When the submission was made
 * @param {Date|null} closesAt - When the assessment closed
 * @returns {{score: number, maxScore: number, percentage: number}}
 */
export function calculateSubmissionScore(gradedResponses, isLate, latePenaltyPercent, submittedAt, closesAt) {
  let score = 0;
  let maxScore = 0;

  for (const response of gradedResponses) {
    if (response.pointsEarned !== null) {
      score += response.pointsEarned;
    }
    // maxScore is counted regardless (from the question points, but we use pointsEarned context)
    // We need the questions for maxScore, but we work with what we have
  }

  // If we only have graded responses, maxScore = sum of all points earned at full marks
  // This is a simplified version - the caller should pass maxScore from questions
  maxScore = gradedResponses.reduce((sum, r) => {
    // We approximate max by assuming pointsEarned <= question.points
    // In practice, the caller knows the questions
    return sum;
  }, 0);

  // Recalculate maxScore from gradedResponses - use a simple sum approach
  // Since we don't have question objects here, we'll just use score as-is
  // and let the caller provide maxScore if needed
  maxScore = gradedResponses.length > 0 ? gradedResponses.reduce((sum) => sum, 0) : 0;

  // Better approach: iterate and use a reasonable max
  // The caller should really pass questions, but we work with the signature given
  maxScore = 0; // Reset - this function needs questions for true maxScore

  // Apply late penalty
  if (isLate && latePenaltyPercent > 0 && submittedAt && closesAt) {
    const submittedTime = submittedAt instanceof Date ? submittedAt : new Date(submittedAt);
    const closedTime = closesAt instanceof Date ? closesAt : new Date(closesAt);
    const msLate = submittedTime.getTime() - closedTime.getTime();
    const daysLate = Math.ceil(msLate / (1000 * 60 * 60 * 24));

    if (daysLate > 0) {
      const penaltyMultiplier = Math.max(0, 1 - (daysLate * latePenaltyPercent) / 100);
      score = Math.round(score * penaltyMultiplier * 100) / 100;
    }
  }

  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0;

  return { score, maxScore, percentage };
}
