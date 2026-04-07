import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';

export function withAuth(Component, allowedRoles) {
  return function ProtectedRoute(props) {
    const { user, role, loading } = useAuth();
    const router = useRouter();

    // Normalize to array
    const roles = Array.isArray(allowedRoles) ? allowedRoles : (allowedRoles ? [allowedRoles] : []);

    // 'ta' means: allow 'student' role users through (class-level TA check happens in the page)
    const effectiveRoles = roles.flatMap(r => r === 'ta' ? ['student'] : [r]);
    // Deduplicate
    const allowed = [...new Set(effectiveRoles)];

    useEffect(() => {
      if (!loading) {
        if (!user) {
          router.replace('/login');
        } else if (allowed.length > 0 && !allowed.includes(role)) {
          router.replace(`/${role}/dashboard`);
        }
      }
    }, [user, role, loading, router]);

    if (loading || !user || (allowed.length > 0 && !allowed.includes(role))) {
      return (
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      );
    }

    return <Component {...props} />;
  };
}
