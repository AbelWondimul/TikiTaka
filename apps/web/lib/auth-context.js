import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // First try custom claims
          const idTokenResult = await firebaseUser.getIdTokenResult();
          let currentRole = idTokenResult.claims.role;

          // Fallback: read from Firestore, with retry for new registrations
          // The Cloud Function takes a few seconds to create the user doc
          if (!currentRole) {
            const docRef = doc(db, 'users', firebaseUser.uid);
            const maxRetries = 5;
            for (let i = 0; i < maxRetries; i++) {
              const docSnap = await getDoc(docRef);
              if (docSnap.exists()) {
                currentRole = docSnap.data().role;
                break;
              }
              // Wait 2s before retrying (Cloud Function needs time)
              if (i < maxRetries - 1) {
                await new Promise((r) => setTimeout(r, 2000));
              }
            }
          }

          setUser(firebaseUser);
          setRole(currentRole || 'student');
        } catch (error) {
          console.error("Error fetching user role:", error);
          setUser(firebaseUser);
          setRole('student');
        }
      } else {
        setUser(null);
        setRole(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
