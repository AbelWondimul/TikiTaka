import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "@/firebase";

/**
 * Uploads a file to Firebase Storage with progress tracking.
 * 
 * @param {string} storagePath - The exact path in storage (e.g., '/knowledgeBase/class123/doc456.pdf').
 * @param {File} file - The File object to upload.
 * @param {function} onProgress - Callback function receiving (percentComplete).
 * @returns {Promise<string>} The download URL of the uploaded file upon completion.
 */
export const uploadWithProgress = (storagePath, file, onProgress) => {
  return new Promise((resolve, reject) => {
    const storageRef = ref(storage, storagePath);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        if (onProgress) {
          onProgress(progress);
        }
      },
      (error) => {
        console.error("Storage upload failed:", error);
        reject(error);
      },
      async () => {
        try {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          resolve(downloadURL);
        } catch (error) {
          console.error("Failed to get download URL:", error);
          reject(error);
        }
      }
    );
  });
};

/**
 * Deletes a file from Firebase Storage.
 * 
 * @param {string} storagePath - The exact path in storage to delete.
 * @returns {Promise<void>} Resolves when deletion is complete.
 */
export const deleteFile = async (storagePath) => {
  try {
    const storageRef = ref(storage, storagePath);
    await deleteObject(storageRef);
  } catch (error) {
    if (error.code === 'storage/object-not-found') {
      console.warn(`File at ${storagePath} not found for deletion. Continuing.`);
      return;
    }
    console.error("Storage deletion failed:", error);
    throw error;
  }
};
