/**
 * Generates a CSV string containing assessment results for all students.
 *
 * @param {import('./types').Assessment} assessment - The assessment object
 * @param {import('./types').Submission[]} submissions - All submissions for this assessment
 * @param {import('./types').Question[]} questions - All questions in the assessment
 * @param {Array<{id: string, name: string, email: string}>} students - Student info
 * @returns {string} CSV formatted string
 */
export function exportResultsCSV(assessment, submissions, questions, students) {
  // Sort questions by orderIndex
  const sortedQuestions = [...questions].sort((a, b) => a.orderIndex - b.orderIndex);

  // Build header
  const baseHeaders = [
    'student_name',
    'student_email',
    'submission_date',
    'time_spent_minutes',
    'score',
    'max_score',
    'percentage',
    'is_late',
    'attempt_number',
  ];

  const questionHeaders = sortedQuestions.map(
    (q, i) => `Q${i + 1} (${q.points}pts)`
  );

  const headers = [...baseHeaders, ...questionHeaders];

  // Build rows
  const rows = submissions.map((submission) => {
    const student = students.find((s) => s.id === submission.studentId);
    const studentName = student ? student.name : 'Unknown';
    const studentEmail = student ? student.email : '';

    const submissionDate = submission.submittedAt
      ? formatDate(submission.submittedAt)
      : '';

    const timeSpentMinutes = submission.timeSpentSeconds
      ? Math.round(submission.timeSpentSeconds / 60 * 100) / 100
      : '';

    const baseValues = [
      escapeCsvField(studentName),
      escapeCsvField(studentEmail),
      submissionDate,
      timeSpentMinutes,
      submission.score ?? '',
      submission.maxScore ?? '',
      submission.percentage != null ? `${submission.percentage}%` : '',
      submission.isLate ? 'Yes' : 'No',
      submission.attemptNumber,
    ];

    // Add per-question scores (placeholder - would need QuestionResponses)
    const questionValues = sortedQuestions.map(() => '');

    return [...baseValues, ...questionValues];
  });

  // Combine header and rows into CSV
  const csvLines = [
    headers.map(escapeCsvField).join(','),
    ...rows.map((row) => row.map(String).join(',')),
  ];

  return csvLines.join('\n');
}

/**
 * Triggers a browser download of a CSV string as a file.
 *
 * @param {string} csvString - The CSV content to download
 * @param {string} filename - The filename for the download (should end in .csv)
 */
export function downloadCSV(csvString, filename) {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the object URL
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Escapes a field value for CSV output.
 * @param {*} value
 * @returns {string}
 */
function escapeCsvField(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formats a Date or Firestore Timestamp for CSV output.
 * @param {Date|{toDate?: () => Date}} date
 * @returns {string}
 */
function formatDate(date) {
  const d = date && typeof date.toDate === 'function' ? date.toDate() : new Date(date);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
