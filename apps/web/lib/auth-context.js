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

          // Fallback: refresh token for new registrations
          // The Cloud Function takes a moment to set the custom claim
          if (!currentRole) {
            const maxRetries = 3;
            for (let i = 0; i < maxRetries; i++) {
              await new Promise((r) => setTimeout(r, 2000));
              await firebaseUser.getIdToken(true); // force refresh
              const refreshedToken = await firebaseUser.getIdTokenResult();
              if (refreshedToken.claims.role) {
                currentRole = refreshedToken.claims.role;
                break;
              }
            }
          }

          setUser(firebaseUser);
          // Only set role if we actually found one, otherwise keep it null 
          // to prevent premature redirection by components using this context
          if (currentRole) {
            setRole(currentRole);
          } else {
            // After all retries, if still no role, and it's not a new user, 
            // we might default, but better to stay null for now or handle in UI
            console.warn("No role found for user after retries");
            setRole(null); 
          }
        } catch (error) {
          console.error("Error fetching user role:", error);
          setUser(firebaseUser);
          setRole(null);
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
