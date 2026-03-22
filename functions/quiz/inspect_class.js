const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

async function inspect() {
  const classId = "i6o0otvqHOJpAypTdVEk";
  const db = admin.firestore();
  
  try {
    const classRef = db.collection("classes").doc(classId);
    const docSnap = await classRef.get();
    
    if (docSnap.exists) {
      console.log("✅ Class document found!");
      console.log(JSON.stringify(docSnap.data(), null, 2));
    } else {
      console.log("❌ Class document NOT found in Firestore.");
    }
  } catch (error) {
    console.error("Error fetching class:", error);
  }
}

inspect();
