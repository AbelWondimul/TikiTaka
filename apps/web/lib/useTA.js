import { useState, useEffect } from 'react';
import { useAuth } from './auth-context';
import { getClassesAsTA } from './classUtils';

/**
 * Hook that provides TA status helpers.
 * - `taClasses`: array of classes where the current user is a TA
 * - `isTA`: true if the user is a TA for at least one class
 * - `isTAForClass(classData)`: checks if user is TA for a specific class
 * - `isTALoading`: true while TA classes are being fetched
 */
export function useTA() {
  const { user } = useAuth();
  const [taClasses, setTaClasses] = useState([]);
  const [isTALoading, setIsTALoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setTaClasses([]);
      setIsTALoading(false);
      return;
    }

    let cancelled = false;
    setIsTALoading(true);
    getClassesAsTA(user.uid).then(classes => {
      if (!cancelled) {
        setTaClasses(classes);
        setIsTALoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [user]);

  const isTAForClass = (classData) => {
    if (!user || !classData) return false;
    return (classData.taIds || []).includes(user.uid);
  };

  return {
    taClasses,
    isTA: taClasses.length > 0,
    isTAForClass,
    isTALoading,
  };
}
