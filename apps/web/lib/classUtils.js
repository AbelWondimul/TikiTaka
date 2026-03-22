import { db } from '../firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

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
