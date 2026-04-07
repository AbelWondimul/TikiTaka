import { db } from '../firebase';
import { doc, getDoc, collection, query, where, getDocs, documentId } from 'firebase/firestore';

/**
 * Generates a random 6-character alphanumeric string to be used as a class code.
 * Excludes confusing characters like 0, O, 1, I, l.
 */
export function generateClassCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Fetches a class document from Firestore by its classId.
 * @param {string} classId - The ID of the class document.
 * @returns {Promise<Object|null>} The class data or null if not found.
 */
export async function getClassById(classId) {
  try {
    const classRef = doc(db, 'classes', classId);
    const classSnap = await getDoc(classRef);
    if (classSnap.exists()) {
      return { id: classSnap.id, ...classSnap.data() };
    }
    return null;
  } catch (error) {
    console.error("Error fetching class by ID:", error);
    return null;
  }
}

/**
 * Fetches a class document from Firestore by its classCode.
 * @param {string} classCode - The 6-character class code.
 * @returns {Promise<Object|null>} The class data or null if not found.
 */
export async function getClassByCode(classCode) {
  try {
    const classesRef = collection(db, 'classes');
    const q = query(classesRef, where('classCode', '==', classCode));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      // Assuming class codes are unique, return the first match
      const classDoc = querySnapshot.docs[0];
      return { id: classDoc.id, ...classDoc.data() };
    }
    return null;
  } catch (error) {
    console.error("Error fetching class by code:", error);
    return null;
  }
}

/**
 * Fetches classes where the user is enrolled as a student.
 * @param {string} uid - The student's UID.
 * @returns {Promise<Object[]>} Array of class objects.
 */
export async function getStudentClasses(uid) {
  try {
    const q = query(collection(db, 'classes'), where('studentIds', 'array-contains', uid));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error("Error fetching student classes:", error);
    return [];
  }
}

/**
 * Fetches classes where the user is a TA.
 * @param {string} uid - The user's UID.
 * @returns {Promise<Object[]>} Array of class objects with `_isTA: true`.
 */
export async function getClassesAsTA(uid) {
  try {
    const q = query(collection(db, 'classes'), where('taIds', 'array-contains', uid));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data(), _isTA: true }));
  } catch (error) {
    console.error("Error fetching TA classes:", error);
    return [];
  }
}

/**
 * Fetches all classes a user can access: owned (teacher) + TA classes.
 * Deduplicates by class ID. TA-only classes are marked with `_isTA: true`.
 * @param {string} uid - The user's UID.
 * @param {string} role - The user's role ('teacher' or 'student').
 * @returns {Promise<Object[]>} Merged array of class objects.
 */
export async function getAccessibleClasses(uid, role) {
  const results = [];
  const seenIds = new Set();

  // If teacher, fetch owned classes
  if (role === 'teacher') {
    try {
      const q = query(collection(db, 'classes'), where('teacherId', '==', uid));
      const snap = await getDocs(q);
      snap.forEach(d => {
        results.push({ id: d.id, ...d.data() });
        seenIds.add(d.id);
      });
    } catch (error) {
      console.error("Error fetching owned classes:", error);
    }
  }

  // Fetch TA classes
  try {
    const taQ = query(collection(db, 'classes'), where('taIds', 'array-contains', uid));
    const taSnap = await getDocs(taQ);
    taSnap.forEach(d => {
      if (!seenIds.has(d.id)) {
        results.push({ id: d.id, ...d.data(), _isTA: true });
        seenIds.add(d.id);
      }
    });
  } catch (error) {
    console.error("Error fetching TA classes:", error);
  }

  return results;
}
