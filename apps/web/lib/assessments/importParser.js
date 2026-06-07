import Papa from 'papaparse';

/**
 * Parses a CSV file into an array of question objects.
 * Expected columns: type, question, choice_a, choice_b, choice_c, choice_d, correct_answer, points, explanation
 *
 * @param {File} file - The CSV file to parse
 * @returns {Promise<Array<import('./types').Question>>} Array of parsed question objects
 */
export function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: (results) => {
        if (results.errors.length > 0) {
          const criticalErrors = results.errors.filter((e) => e.type === 'FieldMismatch' || e.type === 'Quotes');
          if (criticalErrors.length > 0) {
            reject(new Error(`CSV parse error: ${criticalErrors[0].message}`));
            return;
          }
        }

        const questions = results.data.map((row, index) => {
          const type = normalizeType(row.type);
          const choices = buildChoices(row, type);
          const correctAnswer = (row.correct_answer || '').trim();

          return {
            id: `imported_${index}`,
            type,
            orderIndex: index,
            content: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: row.question || '' }] }],
            },
            media: [],
            points: parseFloat(row.points) || 1,
            required: true,
            choices,
            correctAnswer,
            explanation: row.explanation || null,
            codingLanguage: null,
            codingStarterCode: null,
            codingTestCases: null,
            codingShowTestCases: false,
            customHtml: null,
          };
        });

        resolve(questions);
      },
      error: (error) => {
        reject(new Error(`Failed to parse CSV: ${error.message}`));
      },
    });
  });
}

/**
 * Normalizes a question type string to a valid type.
 * @param {string} type
 * @returns {'multiple_choice'|'true_false'|'short_answer'|'essay'|'coding'}
 */
function normalizeType(type) {
  const normalized = (type || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const typeMap = {
    multiple_choice: 'multiple_choice',
    mc: 'multiple_choice',
    true_false: 'true_false',
    tf: 'true_false',
    short_answer: 'short_answer',
    sa: 'short_answer',
    essay: 'essay',
    coding: 'coding',
  };
  return typeMap[normalized] || 'multiple_choice';
}

/**
 * Builds answer choices from a CSV row.
 * @param {Object} row
 * @param {string} type
 * @returns {Array<{label: string, content: Object, isCorrect: boolean}>}
 */
function buildChoices(row, type) {
  if (type === 'short_answer' || type === 'essay' || type === 'coding') {
    return [];
  }

  if (type === 'true_false') {
    const correct = (row.correct_answer || '').trim().toLowerCase();
    return [
      {
        label: 'A',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'True' }] }] },
        isCorrect: correct === 'true' || correct === 'a',
      },
      {
        label: 'B',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'False' }] }] },
        isCorrect: correct === 'false' || correct === 'b',
      },
    ];
  }

  const choices = [];
  const correctAnswers = (row.correct_answer || '').trim().toLowerCase().split(',').map((s) => s.trim());
  const labels = ['a', 'b', 'c', 'd'];

  for (const label of labels) {
    const text = row[`choice_${label}`];
    if (text && text.trim()) {
      choices.push({
        label: label.toUpperCase(),
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: text.trim() }] }],
        },
        isCorrect: correctAnswers.includes(label),
      });
    }
  }

  return choices;
}

/**
 * Generates a CSV template string with header and example rows.
 * @returns {string} CSV template content
 */
export function generateCSVTemplate() {
  const header = 'type,question,choice_a,choice_b,choice_c,choice_d,correct_answer,points,explanation';
  const rows = [
    'multiple_choice,"What is the capital of France?",Paris,London,Berlin,Madrid,a,2,"Paris is the capital of France"',
    'true_false,"The Earth is flat.",True,False,,,b,1,"The Earth is roughly spherical"',
    'short_answer,"What is 2 + 2?",,,,,,1,"The answer is 4"',
    'essay,"Explain the theory of relativity in your own words.",,,,,,5,"Answers may vary"',
  ];

  return [header, ...rows].join('\n');
}

/**
 * Parses a QTI XML string into an array of question objects.
 * Supports basic QTI 2.1 format with choiceInteraction elements.
 *
 * @param {string} xmlString - QTI XML content
 * @returns {Array<import('./types').Question>} Array of parsed question objects
 */
export function parseQTI(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Invalid XML format');
  }

  const questions = [];

  // Try QTI 2.1 format (assessmentItem elements)
  const items = doc.querySelectorAll('assessmentItem, item');

  items.forEach((item, index) => {
    const question = parseQTIItem(item, index);
    if (question) {
      questions.push(question);
    }
  });

  return questions;
}

/**
 * Parses a single QTI assessment item.
 * @param {Element} item
 * @param {number} index
 * @returns {Object|null}
 */
function parseQTIItem(item, index) {
  // Get question text from itemBody or presentation
  const bodyEl = item.querySelector('itemBody, presentation');
  if (!bodyEl) return null;

  // Extract prompt text
  const promptEl = bodyEl.querySelector('prompt, mattext, p');
  const questionText = promptEl ? promptEl.textContent.trim() : bodyEl.textContent.trim();

  if (!questionText) return null;

  // Determine type and extract choices
  const choiceInteraction = item.querySelector('choiceInteraction, response_lid');
  const textInteraction = item.querySelector('extendedTextInteraction, response_str');

  let type = 'short_answer';
  let choices = [];
  let correctAnswer = null;

  if (choiceInteraction) {
    const simpleChoices = choiceInteraction.querySelectorAll('simpleChoice, response_label');

    choices = Array.from(simpleChoices).map((choice, cIndex) => {
      const identifier = choice.getAttribute('identifier') || choice.getAttribute('ident') || String(cIndex);
      return {
        label: String.fromCharCode(65 + cIndex),
        identifier,
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: choice.textContent.trim() }] }],
        },
        isCorrect: false,
      };
    });

    // Find correct answer from responseDeclaration or resprocessing
    const responseDecl = item.querySelector('responseDeclaration, resprocessing');
    if (responseDecl) {
      const correctValues = responseDecl.querySelectorAll('correctResponse value, setvar, varequal');
      correctValues.forEach((val) => {
        const correctId = val.textContent.trim();
        const matchingChoice = choices.find((c) => c.identifier === correctId);
        if (matchingChoice) {
          matchingChoice.isCorrect = true;
          correctAnswer = correctId;
        }
      });
    }

    type = choices.length === 2 &&
      choices.some((c) => c.content.content[0].content[0].text.toLowerCase() === 'true') ?
      'true_false' : 'multiple_choice';
  } else if (textInteraction) {
    const expectedLength = textInteraction.getAttribute('expectedLength');
    type = expectedLength && parseInt(expectedLength) > 200 ? 'essay' : 'short_answer';
  }

  // Get points from outcomeDeclaration or default
  const outcomeDecl = item.querySelector('outcomeDeclaration[identifier="SCORE"], outcomes');
  let points = 1;
  if (outcomeDecl) {
    const defaultValue = outcomeDecl.querySelector('defaultValue value, decvar');
    if (defaultValue) {
      const maxVal = defaultValue.getAttribute('maxvalue') || defaultValue.textContent;
      const parsed = parseFloat(maxVal);
      if (!isNaN(parsed) && parsed > 0) points = parsed;
    }
  }

  return {
    id: `qti_${index}`,
    type,
    orderIndex: index,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: questionText }] }],
    },
    media: [],
    points,
    required: true,
    choices,
    correctAnswer,
    codingLanguage: null,
    codingStarterCode: null,
    codingTestCases: null,
    codingShowTestCases: false,
    customHtml: null,
  };
}
